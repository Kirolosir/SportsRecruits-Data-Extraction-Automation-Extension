// Generates fake athletes for the test site.
// I picked field names on purpose that don't match what lib/extract.js was
// written around. If the test data uses the same names as the code expects,
// the test doesn't really prove anything.

const FIRST = ["Ava","Maya","Liam","Sofia","Noah","Ella","Owen","Iris","Cole","Nina",
  "Ruby","Jonah","Talia","Emmett","Priya","Declan","Rosa","Kai","Hana","Miles"];
const LAST = ["Chen","Okafor","Ruiz","Novak","Bell","Fitzgerald","Haddad","Lindqvist",
  "Moreau","Patel","Sullivan","Whitaker","Kowalski","Ferreira","Adeyemi","Tran"];
const POS = ["Midfield","Attack","Defense","Goalie","Faceoff","LSM"];
const CLUBS = ["Boston Elite","Laxachusetts","Mass Bay United","NE Storm","Cape Cod Select"];
const SCHOOLS = [["Newton North HS","Newton","MA"],["Darien HS","Darien","CT"],
  ["Manhasset HS","Manhasset","NY"],["Moorestown HS","Moorestown","NJ"],
  ["Loyola Blakefield","Towson","MD"],["Culver Academy","Culver","IN"]];

const pick = (arr, i) => arr[i % arr.length];

function makeProspect(n) {
  const first = pick(FIRST, n * 7);
  const last = pick(LAST, n * 3);
  const [school, city, st] = pick(SCHOOLS, n * 5);
  const slugName = `${first}.${last}`.toLowerCase();

  const rec = {
    prospectId: 100000 + n,
    personal: { givenName: first, familyName: last },
    classYear: 2026 + (n % 4),
    primaryPosition: pick(POS, n * 2),
    clubTeam: { name: `${pick(CLUBS, n)} ${2026 + (n % 4)}` },
    schoolInfo: { name: school, city, stateCode: st },
    academics: { gpa: (3.0 + ((n * 13) % 100) / 100).toFixed(2) },
    measurables: { heightInches: 62 + (n % 12), weightLbs: 130 + (n % 60) },
    profilePath: `/prospect/${100000 + n}`,
    // no email here on purpose - a lot of sites only show contact info
    // once you open the actual profile
  };

  // about a third have instagram on the search card
  if (n % 3 === 0) rec.socialLinks = { instagramUrl: `https://instagram.com/${slugName}_lax` };
  return rec;
}

/** Profile view, this is where the email actually shows up. */
function makeDetail(n) {
  const rec = makeProspect(n);
  const slugName = `${rec.personal.givenName}.${rec.personal.familyName}`.toLowerCase();

  // ~15% have no email at all, need to make sure that doesn't break anything
  if (n % 7 !== 0) {
    rec.contactInfo = {
      emailAddress: `${slugName}@examplemail.com`,
      guardianEmail: n % 4 === 0 ? `parent.${slugName}@examplemail.com` : "",
      mobileNumber: `555-01${String(n % 100).padStart(2, "0")}`,
    };
  }
  rec.recruitingNotes = n % 11 === 0
    ? `Best contact is coach at coach.${slugName}@clubmail.com`
    : "";
  return rec;
}

module.exports = { makeProspect, makeDetail };
