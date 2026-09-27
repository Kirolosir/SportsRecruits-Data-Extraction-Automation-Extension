// Regression tests use the extension's message interface, not private test hooks.
// Run: node test-harness/test-unit.js
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { makeProspect, makeDetail } = require('./data');
const root = path.resolve(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; console.log('PASS:', message); }

function environment(options = {}) {
  let now = 0, nextTimer = 0, token = 0;
  const timers = new Map(), handlers = {}, frames = [], logs = [], sent = [];
  const storage = {}, localOps = [], domScans = [];
  let reloadCollection;
  let listener;
  const origin = 'https://sportsrecruits.com';
  const location = { origin, href: origin + '/search' };
  const athletes = options.athletes || Array.from({ length: 8 }, (_, i) => makeProspect(i));
  const cards = athletes.map((athlete,index) => {
    const name = athlete.name || [athlete.personal?.givenName, athlete.personal?.familyName].filter(Boolean).join(' ');
    const link = {
      textContent: 'View Profile', getAttribute: (key) => key === 'href' ? (options.domUrls?.[athlete.prospectId] || '') : null,
    };
    const heading = { textContent: name };
    return {
      getAttribute: key => key==='data-card-index' && options.fastJump ? String(index) : null, contains: () => false,
      ...(options.fastJump ? {getBoundingClientRect:()=>({bottom:(index+1)*100-scroller.scrollTop})} : {}),
      hasAttribute: (key) => !!options.splitNames && key === 'data-card-index',
      querySelector: (selector) => options.splitNames ? { textContent: selector.includes('firstname') ? name.split(' ')[0] : name.split(' ').slice(1).join(' ') } : null,
      querySelectorAll: (selector) => selector === 'a[href]' ? (link.getAttribute('href') ? [link] : []) :
        selector.includes('h1') && !options.splitNames ? [heading] : [],
    };
  });
  const window = { name: options.child ? 'sr-exporter:child-test' : '', addEventListener: (type, fn) => handlers[type] = fn,
    scrollTo() {}, scrollY: 0, innerHeight: 100 };
  window.self = window; window.top = options.child ? {} : window; window.location = location;
  const scroller = { clientHeight: 400, scrollHeight: options.longPage ? 10000 : cards.length * 100, _top: 0,
    get scrollTop() { return this._top; },
    set scrollTop(value) { this._top = options.endlessScroll ? value : Math.min(this.scrollHeight - this.clientHeight, value); },
    querySelector: () => cards[0], contains: other => options.fastJump && cards.includes(other),
    getBoundingClientRect:()=>({bottom:400}) };
  const visibleCards = () => options.longPage ? cards.slice(0, scroller.scrollTop >= 9000 ? 20 : 10) : options.virtualized ? cards.slice(Math.floor(scroller.scrollTop / 100), Math.floor(scroller.scrollTop / 100) + 4) : cards;
  const embeds = (options.embeds || []).map(src => ({src,removed:false,getAttribute() {return this.src;},remove() {this.removed=true;}}));
  const document = {
    readyState: 'complete', documentElement: {},
    querySelectorAll: (selector) => { domScans.push(selector); return selector==='iframe[src]' ? embeds.filter(e=>!e.removed) : selector.startsWith('[data-card-index]') ? visibleCards() :
      (options.virtualized || options.endlessScroll || options.longPage || options.fastJump) && selector === 'div, main, section, ul' ? [scroller] : []; },
    addEventListener: (type, fn) => handlers[type] = fn,
    removeEventListener: (type) => delete handlers[type],
    body: { scrollHeight: 0, appendChild: (frame) => frames.push(frame) },
    createElement: () => ({ style: {}, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; },
      remove() { this.removed = true; } }),
  };
  const chrome = {
    storage: { local: {
      get: async () => { localOps.push('get'); return {...options.restore,...storage}; },
      set: async (value) => { localOps.push('set'); Object.assign(storage, JSON.parse(JSON.stringify(value))); },
      remove: async (keys) => { localOps.push('remove'); keys.forEach((key) => delete storage[key]); },
    } },
    runtime: { sendMessage: async (msg) => {
      sent.push(msg);
      if (msg.type==='SR_REFRESH_COLLECTION') {
        if (options.refreshFails) return {ok:false};
        env.setTimeout(() => reloadCollection(),0);
        return {ok:true};
      }
      return {};
    },
      onMessage: { addListener: (fn) => listener = fn } },
  };
  const env = {
    window, document, chrome, location, URL, TextEncoder, TextDecoder, crypto: { randomUUID: () => String(++token) },
    MutationObserver: class { constructor(fn) {handlers.mutation=fn;} observe() {} disconnect() {} },
    getComputedStyle: () => ({ overflowY: "auto" }),
    console: { log: (...args) => logs.push(args.join(' ')) },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const context = vm.createContext(env);
  vm.runInContext(src('lib/extract.js'), context);
  vm.runInContext(src('content.js'), context);
  const send = (msg) => new Promise((resolve) => {
    const async = listener(msg, {}, resolve); if (!async) flush().then(resolve);
  }).then(async result => {await flush(); return result;});
  const capture = (items) => handlers.message({ source: window, origin, data: {
    tag: '__SR_EXPORTER_CAPTURE__', body: JSON.stringify({ payload: { items } }),
  } });
  reloadCollection = () => {
    timers.clear(); scroller._top=0;
    vm.runInContext(src('content.js'),context);
    capture(athletes);
  };
  const advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
    }
    now = end; await flush();
  };
  const relay = (frame, body, overrides = {}) => send({ type: 'SR_RELAY_PAYLOAD', requestId: frame.name,
    frameId: 7, pageUrl: frame.src, payload: body ? { body: JSON.stringify(body) } : undefined, ...overrides });
  return { send, capture, advance, relay, frames, logs, sent, storage, localOps, context, athletes, handlers, window, embeds, domScans };
}

async function testBatchDefaultsAndPopup() {
  const e = environment(); await flush(); e.capture(e.athletes);
  const initial = await e.send({ type: 'SR_STATUS' });
  await e.send({ type: 'SR_START' });
  const started = await e.send({ type: 'SR_STATUS' });
  check(initial.target === 500 && started.target === 500 && started.total === 8 && started.supportsBatchLimit,
    'Collector defaults to 500 and exposes batch support instead of silently falling back to five');
  await e.send({ type: 'SR_STOP' }); await e.send({ type: 'SR_PURGE' });

  async function popup(status, saved = {}, stopReply = async () => ({ok:true,stats:{...status,running:false}})) {
    const elements = {}, requests = [];
    let listener;
    const get = (id) => elements[id] ||= { value: '', style: {}, disabled: false, textContent: '', className: '', handlers: {},
      classList: { toggle() {}, add() {} }, addEventListener(type, fn) { this.handlers[type] = fn; } };
    const context = vm.createContext({
      document: { getElementById: get, documentElement: { dataset: {} } },
      localStorage: { getItem: k => saved[k] || null, setItem: (k,v) => saved[k] = v },
      matchMedia: () => ({ matches: false }), URL, console, setTimeout, clearTimeout,
      chrome: { tabs: { query: async () => [{ id: 1, url: 'https://my.sportsrecruits.com/recruits' }],
        sendMessage: async (_id,msg) => { requests.push(msg); return status; } },
        runtime: { onMessage: { addListener(fn) { listener=fn; } },
          sendMessage: msg => { requests.push(msg); return stopReply(); } } },
    });
    vm.runInContext(src('popup.js'), context); await flush();
    return { elements, requests, progress: stats => listener({type:'SR_STATUS',stats},{tab:{id:1},frameId:0}) };
  }
  const current = await popup({ total: 200, running: true, target: 200, phase: 'details', detailsDone: 37,
    supportsBatchLimit: true, note: 'Checking profiles: 37 of 200 collected (limit 200).' }, { sr_target: '5' });
  check(current.elements.target.value === '200' && current.elements.target.disabled && current.elements.bar.style.width === '18.5%',
    'Reopening popup displays the active batch size and actual checked-profile progress');
  const old = await popup({ total: 5, running: false, target: 5, note: 'Checked profiles 1/5...' });
  await old.elements.start.handlers.click();
  check(old.elements.start.disabled && /Reload.*SportsRecruits/.test(old.elements.status.textContent) &&
    !old.requests.some(m => m.type === 'SR_START'), 'An outdated tab shows a reload message and cannot silently start another five-athlete run');
  const idle = await popup({ total: 0, running: false, target: 500, supportsBatchLimit: true });
  await idle.elements.start.handlers.click();
  check(idle.requests.some(m => m.type === 'SR_START' && m.target === 500), 'Popup sends 500 for a new batch with no saved preference');
  const saved={sr_target:'40'};
  const settings=await popup({total:0,running:false,target:500,supportsBatchLimit:true},saved);
  settings.elements.target.value='500'; settings.elements.target.handlers.change();
  const reopened=await popup({total:0,running:false,target:500,supportsBatchLimit:true},saved);
  check(reopened.elements.target.value==='500' && !settings.requests.some(m=>m.type==='SR_START'),
    'Changing the batch limit persists it without starting or discarding a collection');
  let finishStop;
  const stopping=await popup({total:100,running:true,target:100,supportsBatchLimit:true}, {},
    () => new Promise(resolve => {finishStop=resolve;}));
  const stopped=stopping.elements.start.handlers.click();
  stopping.progress({total:100,running:true,target:100,supportsBatchLimit:true,note:'Collecting emails: 80 of 100.'});
  await stopping.elements.start.handlers.click();
  check(stopping.elements.start.disabled && stopping.elements.start.textContent==='Stopping…' &&
    stopping.requests.filter(msg=>msg.type==='SR_STOP_REQUEST').length===1,
    'Late progress cannot re-enable Stop or send duplicate stop requests while cancellation is pending');
  finishStop({ok:true,stats:{total:100,running:false,target:100,supportsBatchLimit:true,note:'Stopped.'}});
  await stopped;
  check(!stopping.elements.start.disabled && !stopping.elements.export.disabled && stopping.elements.start.textContent==='Start collecting',
    'A completed Stop enables export of saved recruits');
}

async function testCollection() {
  const e = environment();
  await flush();
  e.capture(e.athletes); // Results were already populated before Start.
  await e.send({ type: 'SR_START', target: 5 });
  check((await e.send({ type: 'SR_STATUS' })).total === 5, 'Start seeds exactly five visible athletes from the captured current result list');
  check(e.frames.length === 2 && e.frames[0].src.endsWith('/prospect/100000'), 'Real JSON profilePath is loaded without a guessed route');
  for (let i = 0; i < 5; i++) {
    const frame = e.frames[i];
    await e.relay(frame, { prospect: makeDetail(7) }, { requestId: 'unrelated' });
    await e.relay(frame, { prospect: makeDetail(7) });
    await e.relay(frame, { prospect: makeDetail(i) }, { frameId: 0 });
    await e.relay(frame, { prospect: makeDetail(i) }, { pageUrl: 'https://sportsrecruits.com/login' });
    // Ignore the redirect message only by using a separate run below; a redirect
    // is intentionally a failure even if later payloads somehow match.
    if (i === 0) {
      await e.send({ type: 'SR_STOP' });
      check(e.frames.every(f => f.removed), 'Stop immediately removes both active frames');
      break;
    }
  }
  await e.send({ type: 'SR_PURGE' });
  e.capture(e.athletes); // Later page traffic must not recapture deleted data.
  await e.advance(30000);
  check(Object.keys(e.storage).length === 0 && (await e.send({ type: 'SR_DATA' })).records.length === 0,
    'Purge cancels pending saves, delayed work and subsequent idle recapture');
}

async function testSuccessfulProfiles() {
  const e = environment(); await flush(); e.capture(e.athletes);
  await e.send({ type: 'SR_START', target: 5 });
  for (let wave = 0; wave < 3; wave++) {
    for (const frame of e.frames.filter(f => !f.removed)) {
    const i = Number(frame.src.split('/').pop()) - 100000;
    await e.relay(frame, { prospect: makeDetail(7) }); // wrong athlete
    await e.relay(frame, { prospect: makeDetail(i) }, { requestId: 'old-run' });
    await e.relay(frame, { prospect: makeDetail(i) }, { frameId: 0 });
    const detail = makeDetail(i);
    // Same number of top-level fields; a deep contact field must still merge.
    detail.contactInfo = { existing: 'kept', emailAddress: `athlete${i}@example.com` };
    detail.positions = [{ name: 'Defense' }];
    await e.relay(frame, null, { payload: { body: '{invalid json' } });
    await e.relay(frame, { payload: { prospect: detail } });
    await e.relay(frame, { prospect: { ...detail, contactInfo: { emailAddress: 'otherframe@example.com' } } }, { frameId: 99 });
    await e.relay(frame, { prospect: { ...makeProspect(i), contactInfo: { emailAddress: '' } } });
    await e.relay(frame, null, { loaded: true, emails: [`dom${i}@example.com`] });
    // Top-frame response cannot add another row or overwrite profile contacts.
    e.capture([makeDetail(7)]);
    }
    await e.advance(15000);
  }
  const { records } = await e.send({ type: 'SR_DATA' });
  check(records.length === 5 && new Set(records.map((r) => r.prospectId)).size === 5, 'Wrong/profile/top-frame responses never add extra athletes or duplicates');
  check(records.every((r, i) => r.contactInfo.emailAddress === `athlete${i}@example.com`), 'Valid profile data recovers from parse noise, rejects other frames and survives later empty fields');
  check(records.every((r) => r.contactInfo.existing === 'kept' && r._srProfileStatus === 'success'), 'Profile objects with array fields preserve outer athlete ID and nested data');
  check(records.every((r, i) => r._srDomEmails.includes(`dom${i}@example.com`)), 'Rendered mailto addresses are attached only after profile identity matches');
  const identified = e.context.SRExtract.extractAthletes({ id: 'stable', personal: { givenName: 'One', familyName: 'Athlete' } });
  check(identified.length === 1 && identified[0].id === 'stable', 'A single personal child cannot strip its parent athlete ID');
  const normalized = e.context.SRExtract.extractAthletes({ root: { type: 'athletes', id: 100001 }, resources: {
    athletes: { 100001: { firstName: 'One', lastName: 'Athlete', sport: { type: 'sports', id: 4 },
      nonIntegratedAffiliations: [{ staff: [{ emailAddress: 'coach@example.com' }] }], emailAddress: 'player@example.com',
      guardians: [{ type: 'contacts', id: 77 }] } },
    contacts: { 77: { firstName: 'Guardian', emailAddress: 'guardian@example.com' } }, sports: { 4: { name: 'soccer' } },
  } });
  check(normalized.length === 1 && normalized[0].id === 100001 && normalized[0].guardians[0].emailAddress === 'guardian@example.com',
    'Observed normalized profile resources preserve map-key athlete identity and resolve only linked contacts');
  vm.runInContext(src('lib/sheet.js'), e.context);
  check(e.context.SRSheet.toContactRow(normalized[0])[1] === 'player@example.com', 'Player email remains primary even when coach fields appear earlier in the profile');
  check(e.context.SRExtract.sweepInstagram({ instagramHandle: 'player_handle', emailAddress: 'player@example.com' })[0] === 'player_handle',
    'Bare SportsRecruits instagramHandle values are captured without treating emails as handles');
  check(e.context.SRSheet.toContactRow({ ...normalized[0], instagramHandle: 'player_handle', coaches: [{instagramHandle:'coach_handle'}] })[11] === '@player_handle',
    'The athlete Instagram handle remains primary when coach handles also exist');
  const wide = { ...normalized[0], _srProfileStatus: 'success', _srProfileReason: 'email_found',
    ...Object.fromEntries(Array.from({length:400}, (_,i) => [`coachEmail${i}`, 'coach@example.com'])) };
  const wideHeaders = e.context.SRSheet.buildSheets([wide])[1].rows[0];
  check(wideHeaders.includes('_srProfileStatus') && wideHeaders.includes('_srProfileReason'), 'Profile diagnostics survive the existing 300-column export limit');
  vm.runInContext(src('lib/sheet.js'), e.context);
  vm.runInContext(src('lib/xlsx.js'), e.context);
  const sheets = e.context.SRSheet.buildSheets(records);
  const contacts = sheets[0].rows.slice(1);
  check(contacts.length === 5 && contacts.every((row) => /athlete\d@example.com/.test(row[1] + ',' + row[2]) && row[12].includes('/prospect/')), 'Contacts has five rows with email and the discovered URL');
  check(e.context.SRSheet.toContactRow({ id: 123, name: 'No URL' })[12] === '', 'Excel does not fabricate a profile URL from an ID');
  const bytes = e.context.SRXlsx.buildXlsx(sheets);
  fs.writeFileSync('/tmp/sr-exporter-regression.xlsx', Buffer.from(bytes));
  check(bytes[0] === 0x50 && bytes[1] === 0x4b, 'Existing XLSX writer still produces a workbook');
  await e.send({ type: 'SR_PURGE' });
}

async function testFailures() {
  for (const kind of ['load-only', 'mismatch', 'same-id-wrong-name', 'none', 'blocked', 'redirect', 'no-email']) {
    const athletes = [makeProspect(1)];
    const e = environment({ athletes }); await flush(); e.capture(athletes);
    await e.send({ type: 'SR_START', target: 5 });
    // One visible result: preserved pagination stops at its normal idle limit.
    await e.advance(13000);
    const frame = e.frames[0]; assert.ok(frame);
    if (kind === 'load-only') await e.relay(frame, null, { loaded: true, emails: ['wrong@example.com'] });
    if (kind === 'mismatch') await e.relay(frame, { prospect: makeDetail(2) });
    if (kind === 'same-id-wrong-name') await e.relay(frame, { prospect: { ...makeDetail(2), prospectId: 100001 } });
    if (kind === 'redirect') await e.relay(frame, { prospect: makeDetail(1) }, { pageUrl: 'https://sportsrecruits.com/login' });
    if (kind === 'blocked') e.handlers.securitypolicyviolation({ effectiveDirective: 'frame-src', blockedURI: frame.src });
    if (kind === 'no-email') await e.relay(frame, { prospect: makeProspect(1) }, { loaded: true });
    await e.advance(16000);
    const [rec] = (await e.send({ type: 'SR_DATA' })).records;
    const reason = { 'load-only': 'profile_loaded_no_payload', mismatch: 'payload_athlete_mismatch', 'same-id-wrong-name': 'payload_athlete_mismatch',
      none: 'no_profile_capture_iframe_blocking_unknown', blocked: 'iframe_blocked_by_parent_csp',
      redirect: 'unexpected_profile_page', 'no-email': 'profile_matched_no_email_found' }[kind];
    check(rec._srProfileReason === reason && rec._srProfileStatus === (kind === 'no-email' ? 'success' : 'failed'),
      `${kind} has a distinct reason; load/mailto alone cannot produce success`);
    await e.send({ type: 'SR_PURGE' });
  }
}

async function testDiscovery() {
  const athlete = { ...makeProspect(1), links: { profile: { href: '/people/actual-route' } } };
  delete athlete.profilePath;
  const e = environment({ athletes: [athlete], domUrls: { 100001: '/real/view/athlete' } });
  await flush(); e.capture([athlete]); await e.send({ type: 'SR_START', target: 5 }); await e.advance(13000);
  check(e.frames[0].src === 'https://sportsrecruits.com/real/view/athlete', 'View Profile href in an exact unique athlete card takes priority');
  await e.send({ type: 'SR_PURGE' });
  const nested = environment({ athletes: [athlete] }); await flush(); nested.capture([athlete]);
  await nested.send({ type: 'SR_START', target: 5 }); await nested.advance(13000);
  check(nested.frames[0].src === 'https://sportsrecruits.com/people/actual-route', 'Nested site-supplied profile href resolves against the actual search origin');
  await nested.send({ type: 'SR_PURGE' });
  const split = environment({ athletes: [athlete], splitNames: true, domUrls: { 100001: '/athlete/actual-link' } });
  await flush(); split.capture([athlete]); await split.send({ type: 'SR_START', target: 5 }); await split.advance(13000);
  check(split.frames[0].src === 'https://sportsrecruits.com/athlete/actual-link', 'Observed virtualized rows associate split name spans with their View Profile link');
  await split.send({ type: 'SR_PURGE' });
  const bare = { ...makeProspect(1), profilePath: undefined, slug: 'athlete-made-up', club: { profileUrl: '/wrong/club' } };
  const missing = environment({ athletes: [bare] }); await flush(); missing.capture([bare]);
  await missing.send({ type: 'SR_START', target: 5 }); await missing.advance(13000);
  check(missing.frames.length === 0 && (await missing.send({ type: 'SR_DATA' })).records[0]._srProfileReason === 'profile_url_not_discovered',
    'Bare slugs and organization profile URLs are rejected');
  await missing.send({ type: 'SR_PURGE' });
  const old = makeProspect(2), current = makeProspect(1);
  const filtered = environment({ athletes: [current], restore: { sr_records: [{ key: 'id:100002', raw: old }] } });
  await flush(); filtered.capture([old, current]); await filtered.send({ type: 'SR_START', target: 5 });
  check((await filtered.send({ type: 'SR_DATA' })).records.length === 1 && (await filtered.send({ type: 'SR_DATA' })).records[0].prospectId === 100001,
    'New Start discards restored/stale records and requires current visible-card association');
  await filtered.send({ type: 'SR_PURGE' });
}

async function answerActiveProfiles(e) {
  for (const frame of e.frames.filter(f => !f.removed)) {
    const id=Number(frame.src.split('/').pop());
    const person={ ...e.athletes.find(a => a.prospectId === id), emailAddress:`player${id}@example.com`, phoneNumber:null, gpa:null };
    await e.relay(frame,{root:{type:'athletes',id},resources:{athletes:{[id]:person}}},{loaded:true});
  }
}

async function testContactSettleNoise() {
  const contact=environment({athletes:[makeProspect(1)]}); await flush(); contact.capture(contact.athletes);
  await contact.send({type:'SR_START',target:1});
  const complete={...makeProspect(1),emailAddress:'player@example.com',phoneNumber:'00123',gpa:{value:3.75}};
  await contact.relay(contact.frames[0],{root:{type:'athletes',id:100001},resources:{athletes:{100001:complete}}});
  await contact.advance(1199);
  check((await contact.send({type:'SR_STATUS'})).running,'Verified direct contacts retain their settle period even before page rendering finishes');
  await contact.advance(1);
  const ready=(await contact.send({type:'SR_DATA'})).records[0];
  check(ready._srProfileStatus==='success' && ready.emailAddress==='player@example.com' && ready.phoneNumber==='00123' && ready.gpa.value===3.75,
    'A complete normalized direct email, phone and GPA response can finish without waiting for unrelated page rendering');
  const missing=environment({athletes:[makeProspect(1)]}); await flush(); missing.capture(missing.athletes);
  await missing.send({type:'SR_START',target:1});
  await missing.relay(missing.frames[0],{root:{type:'athletes',id:100001},resources:{athletes:{100001:{...complete,emailAddress:null}}}});
  await missing.advance(1200);
  check((await missing.send({type:'SR_STATUS'})).running,'A missing direct email still waits for rendered contact evidence instead of taking the early completion path');
  await missing.send({type:'SR_STOP'});
  const e=environment({athletes:[makeProspect(1)]}); await flush(); e.capture(e.athletes);
  await e.send({type:'SR_START',target:1});
  const frame=e.frames[0], person={...makeProspect(1),emailAddress:'player@example.com',phoneNumber:null,gpa:null};
  await e.relay(frame,{root:{type:'athletes',id:100001},resources:{athletes:{100001:person}}},{loaded:true,emails:['player@example.com']});
  await e.advance(500);
  await e.relay(frame,null,{emails:['player@example.com']});
  await e.advance(500);
  await e.relay(frame,null,{emails:['player@example.com']});
  await e.advance(200);
  check(frame.removed && !(await e.send({type:'SR_STATUS'})).running,
    'Repeated unchanged DOM email scans cannot extend the contact settle window');
  await e.send({type:'SR_PURGE'});

  const late=environment({athletes:[makeProspect(1)]}); await flush(); late.capture(late.athletes);
  await late.send({type:'SR_START',target:1}); const f=late.frames[0];
  await late.relay(f,{root:{type:'athletes',id:100001},resources:{athletes:{100001:person}}},{loaded:true});
  await late.advance(1000); await late.relay(f,null,{emails:['late@example.com']});
  await late.advance(200);
  check(!f.removed, 'A genuinely new rendered email still extends contact capture');
  await late.advance(1000);
  check((await late.send({type:'SR_DATA'})).records[0]._srDomEmails.includes('late@example.com'), 'Late rendered emails survive profile completion');
  await late.send({type:'SR_PURGE'});
}

async function testStreamingAndResume() {
  const athletes=Array.from({length:60},(_,i)=>({...makeProspect(i),personal:{givenName:'Player',familyName:String(i)}}));
  const e=environment({athletes}); await flush(); e.capture(athletes);
  await e.send({type:'SR_START',target:500});
  check(e.frames.length===2 && (await e.send({type:'SR_STATUS'})).total===60,
    'Profiles start during discovery before the 500-athlete target is reached');
  await answerActiveProfiles(e); await e.advance(1200);
  check((await e.send({type:'SR_STATUS'})).withEmail===2, 'Emails become visible after the first completed profile pair');
  await e.send({type:'SR_STOP'});
  const before=(await e.send({type:'SR_DATA'})).records.map(r=>r.prospectId);
  await e.send({type:'SR_RESUME_PROFILES'});
  for(let tick=0; tick<40 && (await e.send({type:'SR_STATUS'})).running;tick++) {
    await answerActiveProfiles(e); await e.advance(1200);
  }
  const status=await e.send({type:'SR_STATUS'});
  check(!status.running && status.total===60 && status.withEmail===60 && status.detailsDone===60 &&
    JSON.stringify((await e.send({type:'SR_DATA'})).records.map(r=>r.prospectId))===JSON.stringify(before),
    'Resume preserves all collected athlete IDs, retains completed emails and finishes unfinished profiles');
  await e.send({type:'SR_PURGE'});

  const stuck=environment({athletes:[makeProspect(1)],endlessScroll:true}); await flush(); stuck.capture(stuck.athletes);
  await stuck.send({type:'SR_START',target:500}); await stuck.advance(14500);
  check(stuck.frames.length===1, 'Scrolling forever without discovering new athletes cannot postpone profile capture');
  await answerActiveProfiles(stuck); await stuck.advance(1200);
  check(!(await stuck.send({type:'SR_STATUS'})).running && (await stuck.send({type:'SR_STATUS'})).withEmail===1,
    'A stagnant discovery run finishes its collected profiles instead of hanging at zero emails');
  await stuck.send({type:'SR_PURGE'});

  const tall=environment({athletes:athletes.slice(0,20),longPage:true}); await flush(); tall.capture(tall.athletes);
  await tall.send({type:'SR_START',target:20}); await tall.advance(15000);
  check((await tall.send({type:'SR_STATUS'})).phase==='collecting' && tall.frames.length===0,
    'Tall video cards allow enough viewport steps to reach the next page instead of stopping after eight ticks');
  await tall.advance(35000);
  check((await tall.send({type:'SR_STATUS'})).total===20 && tall.frames.length===2,
    'A later result page beyond eight quiet ticks is discovered and starts contact capture');
  await tall.send({type:'SR_PURGE'});
}

async function testVirtualizedPagination() {
  const athletes = Array.from({ length: 100 }, (_, i) => ({ ...makeProspect(i), personal: { givenName: 'Player', familyName: String(i) } }));
  const e = environment({ athletes, virtualized: true }); await flush(); e.capture(athletes);
  await e.send({ type: 'SR_START', target: 100 });
  for (let tick=0; tick<200 && (await e.send({type:'SR_STATUS'})).running; tick++) {
    await answerActiveProfiles(e);
    await e.advance(1600);
  }
  const { records } = await e.send({ type: 'SR_DATA' });
  check(records.length === 100 && new Set(records.map(r => r.prospectId)).size === 100,
    'Incremental scrolling captures all 100 virtualized cards without skipping middle athletes');
  await e.send({ type: 'SR_STOP' }); await e.send({ type: 'SR_PURGE' });
}

async function testBatchSpeedAndFormatting() {
  const athletes = Array.from({ length: 500 }, (_, i) => ({ ...makeProspect(i), personal: { givenName: "Player", familyName: String(i) } }));
  const e = environment({ athletes }); await flush(); e.capture(athletes);
  await e.send({ type: 'SR_START', target: 500 });
  check((await e.send({ type: 'SR_STATUS' })).total === 500, 'A 500-athlete run honors its limit without the old five-athlete cap');
  let waves = 0;
  while ((await e.send({ type: 'SR_STATUS' })).running) {
    let active = e.frames.filter(f => !f.removed);
    if (!active.length) {
      await e.advance(2000);
      active = e.frames.filter(f => !f.removed);
    }
    assert.ok(active.length <= 2 && active.length > 0, 'Batch keeps at most two profile frames active');
    for (const frame of active.reverse()) {
      const i = Number(frame.src.split('/').pop()) - 100000;
      const person = { ...athletes[i], emailAddress: `player${i}@example.com`, phoneNumber: i === 1 ? '+34 687-78-06-88' : i === 2 ? null : '00123456789',
        gpa: { value: 3.5, scale: 4, scaledGpa: 0, isWeighted: false } };
      await e.relay(frame, { root: { type: 'athletes', id: person.prospectId },
        resources: { athletes: { [person.prospectId]: person } } }, { loaded: true });
    }
    await e.advance(1200);
    if (++waves > 260) throw new Error('Fast path failed to finish in 260 waves including checkpoint refreshes');
  }
  const { records } = await e.send({ type: 'SR_DATA' });
  check(records.length === 500 && records.every((r,i) => r.emailAddress === `player${i}@example.com` && r._srProfileStatus === 'success'),
    'Out-of-order concurrent profile replies preserve all 500 athlete/email matches');
  check(e.sent.some(m => m.stats?.note === 'Collecting emails: 2 of 500 profiles checked (limit 500).'), 'Profile status reports checked count, collected count and chosen limit for a large batch');
  check(waves <= 260 && e.frames.every(f => f.removed) && e.sent.filter(m=>m.type==='SR_REFRESH_COLLECTION').length>=8,
    'A 500-athlete run refreshes between bounded profile batches, resumes automatically, and cleans up every frame');
  vm.runInContext(src('lib/sheet.js'), e.context); vm.runInContext(src('lib/xlsx.js'), e.context);
  const missingPhone = { id: 1, name: 'Player', phoneNumber: null, positions: ['Midfield'], gpa: { scale: 4, scaledGpa: 0, value: 3.68 },
    nonIntegratedAffiliations: [{ staff: [{ position: 'Director', phoneNumber: '9999999999', gpa: 4 }] }] };
  const row = e.context.SRSheet.toContactRow(missingPhone);
  check(row[9] === 3.68 && row[10] === '' && row[4] === 'Midfield', 'GPA uses value; a missing athlete phone never becomes a coach phone or position');
  const sheets = e.context.SRSheet.buildSheets(records);
  fs.writeFileSync('/tmp/sr-exporter-batch.xlsx', Buffer.from(e.context.SRXlsx.buildXlsx(sheets)));
  const xml = new TextDecoder().decode(e.context.SRXlsx.buildXlsx(sheets));
  check(xml.includes('r="K2" s="2" t="inlineStr"') && xml.includes('00123456789') && xml.includes('r="J2" s="3"'),
    'XLSX preserves phone leading zeros as text and applies decimal GPA formatting');
  check(xml.includes('<cols>') && xml.includes('width="24"') && xml.includes('<autoFilter ref="A1:M501"/>'),
    '500-row workbook has explicit column widths, frozen headers and contact filters');
  await e.send({ type: 'SR_PURGE' });

  const partial = environment({ athletes: [makeProspect(0)] }); await flush(); partial.capture(partial.athletes);
  await partial.send({ type: 'SR_START', target: 1 });
  const frame = partial.frames[0];
  await partial.relay(frame, { root: { type: 'athletes', id: 100000 }, resources: { athletes: { 100000: {
    ...makeProspect(0), emailAddress: 'player@example.com' } } } }, { loaded: true });
  await partial.advance(1200);
  check(!frame.removed, 'A partial contact payload keeps the full timeout even when it contains an email');
  await partial.relay(frame, { root: { type: 'athletes', id: 100000 }, resources: { athletes: { 100000: {
    ...makeProspect(0), emailAddress: 'player@example.com', phoneNumber: null, gpa: null } } } });
  await partial.send({ type: 'SR_STOP' }); await partial.advance(16000);
  check(frame.removed && (await partial.send({ type: 'SR_DATA' })).records[0]._srProfileStatus === 'failed', 'Stop cancels queued fast completion and prevents later success');
}

async function testBoundedWork() {
  const e = environment({athletes:Array.from({length:500},(_,i)=>({...makeProspect(i),personal:{givenName:"Player",familyName:String(i)}}))});
  await flush(); e.capture(e.athletes); await e.send({type:'SR_START',target:500});
  const cardScans=e.domScans.filter(selector=>selector.startsWith('[data-card-index]')).length;
  check(cardScans===1,'A 500-athlete discovery indexes visible cards once instead of scanning the entire DOM separately for every athlete');
  await e.send({type:'SR_STOP'});
  check(e.storage.sr_records.length===500 && !e.storage.sr_state.running,
    'Stop acknowledges only after all discovered athletes are saved, without the old five-second checkpoint delay');
  const media=environment({child:true}); await flush();
  const scans=media.domScans.length;
  for(let i=0;i<1000;i++) media.handlers.mutation([{type:'childList',addedNodes:[]}]);
  await media.advance(100);
  check(media.domScans.length-scans===1 && !media.sent.some(msg=>!msg.loaded && !msg.payload),
    'A thousand unrelated widget mutations cause one mailto scan, no whole-page iframe scans, and no repeated email relays');
}

async function testKnownRowsJump() {
  const athletes=Array.from({length:8},(_,i)=>makeProspect(i));
  const domUrls=Object.fromEntries(athletes.map(a=>[a.prospectId,a.profilePath]));
  const known=environment({athletes,domUrls,fastJump:true}); await flush(); known.capture(athletes);
  await known.send({type:'SR_START',target:500});
  check(known.context.document.querySelectorAll('div, main, section, ul')[0].scrollTop===400,
    'Discovery reaches the next-results marker in one scroll when every mounted row has already been captured');
  // A target reached during ingest normally starts profiles rather than scrolling;
  // capture only five of the eight mounted rows instead, keeping the run active.
  const partial=environment({athletes,domUrls,fastJump:true}); await flush(); partial.capture(athletes.slice(0,5));
  await partial.send({type:'SR_START',target:500});
  check(partial.context.document.querySelectorAll('div, main, section, ul')[0].scrollTop===300,
    'Unknown mounted athletes prevent long jumps, retaining bounded scrolling so virtualized recruits are not skipped');
  await known.send({type:'SR_STOP'}); await partial.send({type:'SR_STOP'});
}

async function testIncrementalCheckpoints() {
  const e=environment(); await flush(); e.capture(e.athletes); await e.send({type:'SR_START',target:5});
  await answerActiveProfiles(e); await e.advance(1200);
  const first=e.storage['sr_profile_id:100000'];
  check(first?.detail==='success' && first.raw.emailAddress==='player100000@example.com' &&
    !e.storage.sr_records[0].raw.emailAddress,
    'Each completed profile saves one incremental checkpoint without rewriting the full batch');
  const restored=environment({restore:JSON.parse(JSON.stringify(e.storage))}); await flush();
  const data=await restored.send({type:'SR_DATA'});
  check(data.records[0].emailAddress==='player100000@example.com' && data.records[0]._srProfileStatus==='success',
    'Reload overlays completed profile checkpoints onto the saved athlete list');
  await e.send({type:'SR_STOP'}); await e.send({type:'SR_PURGE'});
  check(!Object.keys(e.storage).some(key=>key.startsWith('sr_profile_')),'Purge removes incremental profile checkpoints as well as the athlete list');
}

async function testRefreshLifecycle() {
  const athletes=Array.from({length:100},(_,i)=>({...makeProspect(i),personal:{givenName:'Player',familyName:String(i)}}));
  const failing=environment({athletes,refreshFails:true}); await flush(); failing.capture(athletes);
  await failing.send({type:'SR_START',target:100});
  for (let wave=0;wave<35 && (await failing.send({type:'SR_STATUS'})).running;wave++) {
    await answerActiveProfiles(failing); await failing.advance(1200);
  }
  check(!failing.storage.sr_state.running && !failing.storage.sr_state.automaticRefresh && failing.storage.sr_records.length===100 &&
    failing.storage.sr_records.filter(r=>r.detail==='success').length>=60,
    'A rejected automatic refresh stops safely and retains all recruits and completed emails for export or resume');
  const checkpoint={sr_records:failing.storage.sr_records,sr_state:{running:true,target:100,
    automaticRefresh:{token:'test',url:'https://sportsrecruits.com/search',at:Date.now()}}};
  const resumed=environment({athletes,restore:checkpoint}); await flush();
  await resumed.send({type:'SR_STOP'}); await resumed.advance(5000);
  check(!(await resumed.send({type:'SR_STATUS'})).running && !resumed.storage.sr_state.automaticRefresh && resumed.frames.length===0,
    'Stop during automatic restoration clears its continuation marker and prevents further profile work');
  const expired=environment({athletes,restore:{...checkpoint,sr_state:{...checkpoint.sr_state,
    automaticRefresh:{...checkpoint.sr_state.automaticRefresh,at:Date.now()-61000}}}}); await flush(); await expired.advance(5000);
  check(!(await expired.send({type:'SR_STATUS'})).running && expired.frames.length===0,
    'An expired automatic continuation does not restart collection after a later manual reload');
}

async function testChildRelay() {
  const sources=['https://app.sportsrecruits.com/video-playlists/132440/embedded-player?source=null',
    'https://app.sportsrecruits.com/contact-widget', 'https://example.com/video-playlists/132440/embedded-player', 'about:blank'];
  const e = environment({ child: true, embeds:sources }); await flush(); e.capture([makeDetail(1)]);
  check(e.sent.some((msg) => msg.type === 'SR_IFRAME_PAYLOAD' && msg.requestId === 'sr-exporter:child-test' && msg.payload),
    'Managed child relays captured JSON with a per-load request ID');
  check(e.localOps.length === 0, 'Child never reads or writes top-frame collection storage');
  check(e.embeds[0].removed && e.embeds.slice(1).every(frame=>!frame.removed),
    'Hidden capture pages omit only the observed video-player embed while retaining contact and unrelated frames');
  e.embeds[3].src=sources[0]; e.handlers.mutation(); await e.advance(100);
  check(e.embeds[3].removed, 'Video previews added after readiness are also removed from hidden capture pages');
  const visible=environment({embeds:sources}); await flush();
  check(visible.embeds.every(frame=>!frame.removed && frame.src===sources[visible.embeds.indexOf(frame)]), 'Video previews on an idle visible search page remain intact');
  visible.capture(visible.athletes); await visible.send({type:'SR_START',target:5});
  check(visible.embeds[0].src==='about:blank' && visible.embeds.slice(1).every((frame,i)=>frame.src===sources[i+1]),
    'Collection pauses only observed search video previews without changing contact or unrelated frames');
  visible.embeds[3].src=sources[0]; visible.handlers.mutation(); await visible.advance(100);
  check(visible.embeds[3].src==='about:blank', 'New search previews are also paused during collection');
  await visible.send({type:'SR_STOP'});
  check(visible.embeds[0].src===sources[0] && visible.embeds[3].src===sources[0] && visible.embeds[0].loading==='lazy',
    'Stop restores original video URLs with lazy loading instead of restarting every offscreen player');
  await visible.send({type:'SR_PURGE'});
}

async function testBackground() {
  const session = {}, messages = [], removals = [], reloads = [], created=[], closed=[], grouped=[];
  const checkpoint = {sr_records: [{key:'id:1',raw:{id:1,emailAddress:'player@example.com'},detail:'success'},
    {key:'id:2',raw:{id:2},detail:'pending'}],sr_state:{running:true,target:100}};
  let onMessage, onChanged, onInstalled, onStartup;
  let downloadState = 'in_progress';
  let hungPage = false;
  let delayCreation=false, pendingCreate;
  const chrome = {
    storage: { session: {
      get: async (key) => ({ [key]: session[key] }), set: async (v) => Object.assign(session, v),
      remove: async (key) => delete session[key],
    }, local: { remove: async (keys) => removals.push(keys), get:async()=>checkpoint, set:async value=>Object.assign(checkpoint,value) } },
    tabs: { get:async id=>({id,windowId:1,index:2,active:true,groupId:7,url:id===99?'https://example.com':'https://my.sportsrecruits.com/recruits'}),
      group:async options=>grouped.push(options),
      create:async options=>{created.push(options);return delayCreation ? new Promise(resolve=>{pendingCreate=resolve;}) : {id:121};},remove:async id=>closed.push(id),
      reload:async id=>reloads.push(id), sendMessage: async (...args) => {
        messages.push(args);
        if(args[1].type==='SR_STOP') return hungPage ? new Promise(()=>{}) : {running:false,total:2};
      }, query: async () => [{ id: 10 }, { id: 11 }] },
    downloads: { search: async ({ id }) => [{ id, state: downloadState }], onChanged: { addListener: (fn) => onChanged = fn } },
    runtime: { getManifest: () => JSON.parse(src('manifest.json')), onMessage: { addListener: (fn) => onMessage = fn }, onStartup: { addListener(fn) { onStartup=fn; } }, onInstalled: { addListener(fn) { onInstalled=fn; } } },
  };
  const load = () => vm.runInContext(src('background.js'), vm.createContext({ chrome, URL, setTimeout, clearTimeout }));
  load();
  onInstalled({reason:'update'}); await flush();
  check(removals.length===0, 'Reloading/updating the extension preserves an unfinished collection');
  const send = (msg, sender = {}) => new Promise((resolve) => {
    if (!onMessage(msg, sender, resolve)) flush().then(resolve);
  });
  await send({ type: 'SR_IFRAME_PAYLOAD', requestId: 'sr-exporter:test', payload: { body: '{}' } },
    { tab: { id: 10 }, frameId: 8, url: 'https://sportsrecruits.com/profile/real' });
  check(messages[0][0] === 10 && messages[0][2].frameId === 0 && messages[0][1].frameId === 8,
    'Background relays to frame zero with browser-supplied child frame identity');
  await send({ type: 'SR_TRACK_DOWNLOAD', downloadId: 1, tabId: 10 });
  load(); // Simulate MV3 suspension/restart while saving.
  onChanged({ id: 1, state: { current: 'interrupted' } }); await flush();
  check(removals.length === 0, 'Cancelled download preserves collection after worker restart');
  await send({ type: 'SR_TRACK_DOWNLOAD', downloadId: 2, tabId: 10 }); load();
  onChanged({ id: 2, state: { current: 'complete' } }); await flush();
  check(removals.length === 1 && messages.at(-1)[1].type === 'SR_PURGE' && messages.at(-1)[2].frameId === 0 && messages.at(-1)[0] === 11,
    'Confirmed completion purges storage and all exporter tab copies after worker restart');
  downloadState = 'complete';
  await send({ type: 'SR_TRACK_DOWNLOAD', downloadId: 3, tabId: 10 });
  check(removals.length === 2, 'Completion before download tracking registration is detected');
  checkpoint.sr_state={running:true,automaticRefresh:{token:'fresh',url:'https://my.sportsrecruits.com/recruits',at:Date.now()}};
  const refreshed=await send({type:'SR_REFRESH_COLLECTION',token:'fresh'},{tab:{id:20},frameId:0});
  check(refreshed.ok && refreshed.tabId===121 && created[0].url===checkpoint.sr_state.automaticRefresh.url && created[0].index===2 && closed[0]===20,
    'The worker replaces only a running top-frame collection with a fresh matching checkpoint, retaining its exact URL and tab position');
  check(grouped[0].groupId===7 && grouped[0].tabIds[0]===121,'The replacement joins the original saved group before the old tab closes, preserving that group');
  const rejected=await send({type:'SR_REFRESH_COLLECTION',token:'wrong'},{tab:{id:10},frameId:0});
  check(!rejected.ok && created.length===1,'An unrelated or stale refresh request cannot replace a tab');
  const transferredStop=await send({type:'SR_STOP_REQUEST',tabId:20});
  check(transferredStop.ok && messages.at(-1)[0]===121,'Stop follows an automatic tab transfer and cancels work in the replacement tab');
  load();
  const restartedStop=await send({type:'SR_STOP_REQUEST',tabId:20});
  check(restartedStop.ok && messages.at(-1)[0]===121,'Stop follows a saved tab transfer even after the worker restarts');
  delayCreation=true;
  const duringRefresh=send({type:'SR_REFRESH_COLLECTION',token:'fresh'},{tab:{id:30},frameId:0});
  await flush();
  const duringStop=send({type:'SR_STOP_REQUEST',tabId:30});
  pendingCreate({id:122});
  const [createdDuringStop,stoppedDuringTransfer]=await Promise.all([duringRefresh,duringStop]);
  check(createdDuringStop.ok && stoppedDuringTransfer.ok && messages.at(-1)[0]===122,
    'Stop requested while a fresh tab is still opening waits for the transfer and cancels the new tab');
  delayCreation=false;
  const gracefulStop=await send({type:'SR_STOP_REQUEST',tabId:10});
  check(gracefulStop.ok && !gracefulStop.stats.running && reloads.length===0,'Worker Stop preserves a responsive page and waits for its saved acknowledgement');
  hungPage=true;
  const stopMessages=messages.filter(([,msg])=>msg.type==='SR_STOP').length;
  const [recovery, duplicateStop] = await Promise.all([send({type:'SR_STOP_REQUEST',tabId:10}),send({type:'SR_STOP_REQUEST',tabId:10})]);
  check(duplicateStop.ok && messages.filter(([,msg])=>msg.type==='SR_STOP').length===stopMessages+1 && reloads.length===1,
    'Repeated Stop requests share one cancellation and one recovery reload');
  check(recovery.ok && reloads[0]===10 && !checkpoint.sr_state.running && checkpoint.sr_records.length===2 &&
    checkpoint.sr_records[0].raw.emailAddress==='player@example.com' && checkpoint.sr_records[1].detail==='failed',
    'Stop recovery terminates a stuck tab without waiting on its renderer and keeps completed contacts plus retryable unfinished athletes');
  const invalidRecovery = await send({type:'SR_STOP_RECOVER',tabId:99});
  check(!invalidRecovery.ok && reloads.length===1,'Stop recovery refuses to reload unrelated websites');
  await send({type:'SR_STATUS',stats:{total:100,running:true}}, {tab:{id:10},frameId:0});
  load();
  const cached=await send({type:'SR_LAST_STATUS',tabId:10});
  check(cached.total===100 && cached.running,'Popup can recover progress from the worker after the page stops answering, including after worker restart');
  onStartup(); onInstalled({reason:'install'}); await flush();
  check(removals.length===4, 'Browser restart and first installation still clear local data');
}

(async () => {
  await testBatchDefaultsAndPopup(); await testCollection(); await testSuccessfulProfiles(); await testFailures(); await testDiscovery(); await testContactSettleNoise(); await testStreamingAndResume(); await testVirtualizedPagination(); await testBatchSpeedAndFormatting(); await testBoundedWork(); await testKnownRowsJump(); await testIncrementalCheckpoints(); await testRefreshLifecycle(); await testChildRelay(); await testBackground();
  console.log(`\n${checks} checks passed. Live SportsRecruits behavior is not simulated by these checks.`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
