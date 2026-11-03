// Deterministic fake data. Every person, company and document is invented.
// Emails use example.com / example.net / example.org and the .example TLD,
// which RFC 2606 reserves for documentation, so none of them can reach anyone.
// IP addresses come from the RFC 5737 documentation ranges for the same reason.
import { SEED_TODAY } from './config.js';

function mulberry32(seed) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261103);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function uuid() {
  const hex = [];
  for (let i = 0; i < 16; i++) hex.push(Math.floor(rand() * 256));
  hex[6] = (hex[6] & 0x0f) | 0x40;
  hex[8] = (hex[8] & 0x3f) | 0x80;
  const h = hex.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const FIRST = [
  'Lena', 'Jonas', 'Mia', 'Elias', 'Sofia', 'Noah', 'Amira', 'Luca', 'Hannah', 'Mateo',
  'Yara', 'Felix', 'Ines', 'Omar', 'Clara', 'Theo', 'Leila', 'Paul', 'Nina', 'Emil',
  'Zoe', 'Ben', 'Aylin', 'Finn', 'Maja', 'Karim', 'Lea', 'Jan', 'Priya', 'Tom',
  'Sara', 'David', 'Nora', 'Malik', 'Julia', 'Anton', 'Elif', 'Max', 'Ida', 'Samuel',
  'Chloe', 'Ravi', 'Greta', 'Leon', 'Aisha', 'Moritz', 'Lina', 'Hugo', 'Mara', 'Can',
];
const LAST = [
  'Becker', 'Schneider', 'Nguyen', 'Yilmaz', 'Fischer', 'Kowalski', 'Rossi', 'Hoffmann', 'Meyer', 'Novak',
  'Schulz', 'Garcia', 'Wagner', 'Kaya', 'Lange', 'Moreau', 'Weber', 'Brandt', 'Silva', 'Keller',
  'Hartmann', 'Ozturk', 'Vogel', 'Lindqvist', 'Krause', 'Petrov', 'Haas', 'Costa', 'Jung', 'Bauer',
  'Martin', 'Sommer', 'Dubois', 'Arslan', 'Frank', 'Winter', 'Ricci', 'Berg', 'Kim', 'Roth',
];
const DOMAINS = ['example.com', 'example.net', 'example.org'];
const STUDIO_A = ['Kestrel', 'Lumen', 'Copper', 'Fjord', 'Marlow', 'Pinewood', 'Saltbox', 'Juniper', 'Quarry', 'Ember', 'Hollow', 'Tidewater'];
const STUDIO_B = ['Studio', 'Design', 'Labs', 'Media', 'Works', 'Digital', 'Collective', 'Atelier'];
const CITIES = ['Stuttgart', 'Berlin', 'Munich', 'Hamburg', 'Cologne', 'Leipzig', 'Vienna', 'Zurich', 'Amsterdam', 'Lisbon', 'Barcelona', 'Prague'];
const WORK = [
  'Website redesign', 'Brand workshop (2 days)', 'Monthly retainer', 'Landing page copy', 'Logo and brand kit',
  'Product photography', 'App UI design sprint', 'SEO audit', 'Newsletter setup', 'Pitch deck design',
  'Video edit (3 cuts)', 'Shopify store setup', 'Illustration set', 'Webflow build', 'Social media month',
];
const CLIENT_A = ['Harbor', 'Vela', 'Oakline', 'Brightside', 'Nordlicht', 'Granite', 'Bluefern', 'Sunday', 'Wildrose', 'Northgate', 'Lighthouse', 'Riverstone'];
const CLIENT_B = ['Coffee', 'Bikes', 'Dental', 'Yoga', 'Bakery', 'Architects', 'Logistics', 'Fitness', 'Books', 'Interiors', 'Wines', 'Clinic'];

const TODAY = new Date(`${SEED_TODAY}T09:00:00Z`).getTime();
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

export function buildSeed() {
  const profiles = [];
  const invoices = [];
  const files = []; // { bucket, path, owner, kind, created_at }

  // Staff accounts. The UI shows the admin page only when is_admin is true.
  const staff = [
    { full_name: 'Jonas Weber', email: 'jonas@tallybird.example' },
    { full_name: 'Priya Nair', email: 'priya@tallybird.example' },
  ];
  for (const s of staff) {
    profiles.push({
      id: uuid(), full_name: s.full_name, email: s.email, company: 'Tallybird', city: 'Stuttgart',
      plan: 'team', is_admin: true, id_verified: true, created_at: iso(TODAY - 400 * DAY),
    });
  }

  // The canary: a row nobody legitimate ever reads. The app raises an alarm
  // the moment it shows up in any response. Alarm one of three.
  profiles.push({
    id: '00000000-0000-4000-8000-00000000ca11', full_name: 'Finance Ops (internal)',
    email: 'finance-ops@tallybird.example', company: 'Tallybird', city: 'Stuttgart',
    plan: 'team', is_admin: true, id_verified: false, created_at: iso(TODAY - 380 * DAY), canary: true,
  });

  for (let i = 0; i < 1281; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const roll = rand();
    profiles.push({
      id: uuid(),
      full_name: `${first} ${last}`,
      email: `${first}.${last}${rand() < 0.35 ? between(1, 99) : ''}@${pick(DOMAINS)}`.toLowerCase(),
      company: rand() < 0.7 ? `${pick(STUDIO_A)} ${pick(STUDIO_B)}` : `${first} ${last} Freelance`,
      city: pick(CITIES),
      plan: roll < 0.7 ? 'free' : roll < 0.95 ? 'pro' : 'team',
      is_admin: false,
      id_verified: rand() < 0.3,
      created_at: iso(TODAY - between(2, 520) * DAY - between(0, 86399) * 1000),
    });
  }
  profiles.sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Invoices get sequential ids, the way a default auto-increment column does.
  const customers = profiles.filter((p) => !p.is_admin);
  const drafts = [];
  for (let i = 0; i < 3211; i++) {
    const owner = pick(customers);
    const created = Math.max(new Date(owner.created_at).getTime(), TODAY - between(1, 400) * DAY);
    const roll = rand();
    const due = created + between(14, 30) * DAY;
    const clientA = pick(CLIENT_A);
    const clientB = pick(CLIENT_B);
    drafts.push({
      owner_id: owner.id,
      client_name: `${clientA} ${clientB}`,
      client_email: `billing@${clientA.toLowerCase()}-${clientB.toLowerCase()}.example`,
      description: pick(WORK),
      amount_eur: between(15, 980) * 10,
      status: roll < 0.15 ? 'draft' : due < TODAY && roll < 0.42 ? 'overdue' : 'paid',
      due_date: iso(due).slice(0, 10),
      created_at: iso(created),
    });
  }
  drafts.sort((a, b) => a.created_at.localeCompare(b.created_at));
  drafts.forEach((d, i) => invoices.push({ id: 1001 + i, ...d }));

  // Identity documents for verified users, stored under <user id>/.
  for (const p of profiles) {
    if (!p.id_verified || p.is_admin) continue;
    files.push({
      bucket: 'id-verification', path: `${p.id}/id-front.svg`, owner: p.id, kind: 'idcard',
      created_at: iso(new Date(p.created_at).getTime() + DAY),
    });
  }

  return { profiles, invoices, files };
}

export function fakeIp(seedText) {
  let h = 0;
  for (const c of seedText) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const ranges = ['192.0.2', '198.51.100', '203.0.113'];
  return `${ranges[h % 3]}.${(h >>> 8) % 254 + 1}`;
}

export function fakeBirthDate(seedText) {
  let h = 7;
  for (const c of seedText) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  const year = 1965 + (h % 38);
  const month = String(((h >>> 6) % 12) + 1).padStart(2, '0');
  const day = String(((h >>> 11) % 28) + 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
