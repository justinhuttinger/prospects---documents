// Map each WCS gym to its Paychex Flex companyId. Mirrors
// `wcs-staff-portal/auth/src/config/paychexLocations.js`. Each location is a
// separate Paychex company; mirror the env vars onto this service to enable
// HR-based location resolution.

const PAYCHEX_LOCATIONS = [
  { companyId: process.env.PAYCHEX_COMPANY_SALEM,       name: 'Salem',       slug: 'salem' },
  { companyId: process.env.PAYCHEX_COMPANY_KEIZER,      name: 'Keizer',      slug: 'keizer' },
  { companyId: process.env.PAYCHEX_COMPANY_EUGENE,      name: 'Eugene',      slug: 'eugene' },
  { companyId: process.env.PAYCHEX_COMPANY_SPRINGFIELD, name: 'Springfield', slug: 'springfield' },
  { companyId: process.env.PAYCHEX_COMPANY_CLACKAMAS,   name: 'Clackamas',   slug: 'clackamas' },
  { companyId: process.env.PAYCHEX_COMPANY_MILWAUKIE,   name: 'Milwaukie',   slug: 'milwaukie' },
  { companyId: process.env.PAYCHEX_COMPANY_MEDFORD,     name: 'Medford',     slug: 'medford' },
].filter((l) => l.companyId);

module.exports = { PAYCHEX_LOCATIONS };
