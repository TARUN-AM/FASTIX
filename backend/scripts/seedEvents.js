require("dotenv").config();

const User = require("../src/models/User.model");
const Event = require("../src/models/Event.model");
const {
  USER_ROLES,
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  MAX_ACTIVE_TICKETS,
  DEFAULT_HOLD_MINUTES,
} = require("../src/config/constants");
const { calculateMaxResalePrice } = require("../src/utils/money");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");

const DEMO_ORGANIZER_EMAIL = "organizer@fairticket.demo";

function buildDemoEventSpecs(now = new Date()) {
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const baseMs = now.getTime();

  return [
    {
      title: "Demo Concert: Summer Lights",
      description:
        "An outdoor evening music showcase featuring independent acoustic and synth performers under summer skies. Verified identity and fair resale caps apply to every ticket.",
      artist: "Demo Ensemble",
      category: EVENT_CATEGORIES.CONCERT,
      venueName: "Harborview Open Arena",
      city: "Mumbai",
      registrationOpenAt: new Date(baseMs - 5 * minuteMs),
      registrationCloseAt: new Date(baseMs + 60 * minuteMs),
      eventDate: new Date(baseMs + 30 * dayMs),
      basePricePaise: 500000, // Rs 5,000
      totalTickets: 100,
      maxTicketsPerIdentity: MAX_ACTIVE_TICKETS,
      holdDurationMinutes: DEFAULT_HOLD_MINUTES,
    },
    {
      title: "Demo Concert: City Beats",
      description:
        "A high-energy urban rhythm and percussion night hosted in the central amphitheatre. Queue registration opens soon for verified fans.",
      artist: "City Rhythm Collective",
      category: EVENT_CATEGORIES.FESTIVAL,
      venueName: "Central City Amphitheatre",
      city: "Bengaluru",
      registrationOpenAt: new Date(baseMs + 2 * hourMs),
      registrationCloseAt: new Date(baseMs + 3 * hourMs),
      eventDate: new Date(baseMs + 45 * dayMs),
      basePricePaise: 250000, // Rs 2,500
      totalTickets: 500,
      maxTicketsPerIdentity: MAX_ACTIVE_TICKETS,
      holdDurationMinutes: DEFAULT_HOLD_MINUTES,
    },
    {
      title: "Demo Concert: Riverside Night",
      description:
        "An intimate riverside live performance with a short registration window designed for end-to-end queue and booking demonstrations.",
      artist: "Riverside Sessions",
      category: EVENT_CATEGORIES.CONCERT,
      venueName: "Riverfront Cultural Pavilion",
      city: "Pune",
      registrationOpenAt: new Date(baseMs - 1 * minuteMs),
      registrationCloseAt: new Date(baseMs + 10 * minuteMs),
      eventDate: new Date(baseMs + 20 * dayMs),
      basePricePaise: 750000, // Rs 7,500
      totalTickets: 50,
      maxTicketsPerIdentity: MAX_ACTIVE_TICKETS,
      holdDurationMinutes: DEFAULT_HOLD_MINUTES,
    },
  ];
}

async function seedEvents(options = {}) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv === "production") {
    throw new Error(
      "Refusing to seed demo events when NODE_ENV is set to production."
    );
  }

  const organizer = await User.findOne({
    email: DEMO_ORGANIZER_EMAIL,
    role: USER_ROLES.ORGANIZER,
  });

  if (!organizer) {
    throw new Error(
      `Demo organizer ${DEMO_ORGANIZER_EMAIL} was not found. Please run "npm run seed:staff" first.`
    );
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const specs = buildDemoEventSpecs(now);
  const summary = [];

  for (const spec of specs) {
    const existing = await Event.findOne({ title: spec.title }).lean();
    if (existing) {
      summary.push({
        title: spec.title,
        status: "already existed",
        id: String(existing._id),
      });
      continue;
    }

    const created = await Event.create({
      organizerId: organizer._id,
      title: spec.title,
      description: spec.description,
      artist: spec.artist,
      category: spec.category,
      venueName: spec.venueName,
      city: spec.city,
      registrationOpenAt: spec.registrationOpenAt,
      registrationCloseAt: spec.registrationCloseAt,
      eventDate: spec.eventDate,
      basePricePaise: spec.basePricePaise,
      maxResalePricePaise: calculateMaxResalePrice(spec.basePricePaise),
      totalTickets: spec.totalTickets,
      availableTickets: spec.totalTickets,
      heldTickets: 0,
      soldTickets: 0,
      maxTicketsPerIdentity: spec.maxTicketsPerIdentity,
      holdDurationMinutes: spec.holdDurationMinutes,
      status: EVENT_STATUSES.PUBLISHED,
      publishedAt: now,
    });

    summary.push({
      title: created.title,
      status: "created",
      id: String(created._id),
    });
  }

  return summary;
}

async function runCli() {
  try {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "Refusing to run demo event seed when NODE_ENV=production."
      );
      process.exit(1);
    }

    await connectDatabase();
    const summary = await seedEvents();
    console.log("FairTicket demo event seed summary:");
    for (const item of summary) {
      console.log(`- ${item.title}: ${item.status} (id=${item.id})`);
    }
    await disconnectDatabase();
    process.exit(0);
  } catch (err) {
    console.error(`Demo event seed failed: ${err.message}`);
    try {
      await disconnectDatabase();
    } catch (_disconnectErr) {
      // ignore disconnect cleanup error
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEMO_ORGANIZER_EMAIL,
  buildDemoEventSpecs,
  seedEvents,
};
