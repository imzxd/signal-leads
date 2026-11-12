import type { LeadSource, LeadStage, Urgency } from "@/types/domain";

/**
 * Scripted demo leads for Evergreen Roofing. The seeder converts each script into
 * messages, timeline events, score history, follow-ups and appointments.
 *
 * Step kinds:
 *  in        customer message           out:first   first automated response (asks next question)
 *  out:ask   automated question         out:offer   booking offer (slots generated)
 *  out:confirm booking confirmation     out:fu1..3  automated follow-up
 *  out:hold  handoff holding message    out:close   closing message
 *  staff     message from a team member note        internal note
 */
export type StepKind = "in" | "out:first" | "out:ask" | "out:offer" | "out:confirm" | "out:fu1" | "out:fu2" | "out:fu3" | "out:hold" | "out:close" | "staff" | "note";
export interface Step {
  k: StepKind;
  t: string;
  /** Minutes after the lead was created. */
  m: number;
}

export interface DemoLead {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source: LeadSource;
  channel: "email" | "sms";
  service: string | null;
  serviceRequested?: string;
  location: string | null;
  address?: string;
  propertyType?: string;
  roofAge?: string;
  urgency: Urgency;
  timeline?: string;
  budget?: string;
  daysAgo: number;
  stage: LeadStage;
  score: number;
  summary: string;
  control?: "autopilot" | "paused" | "human";
  assignedToEstimator?: boolean;
  recovered?: boolean;
  wonValue?: number;
  lostReason?: string;
  /** Days from now (negative = past) for the appointment, if any. */
  appointmentDays?: number;
  appointmentHour?: number;
  /** Remaining follow-ups to keep scheduled (for leads waiting on a reply). */
  pendingFollowUps?: number;
  isSpam?: boolean;
  handoffReason?: string;
  script: Step[];
}

export const DEMO_LEADS: DemoLead[] = [
  // ---------------------------------------------------------------- WON
  {
    name: "Priya Raman", email: "priya.raman@example.com", phone: "+15195550142", source: "form", channel: "email",
    service: "roof_replacement", location: "Guelph", address: "88 Woodlawn Rd W", propertyType: "house", roofAge: "22 years", urgency: "soon", timeline: "before winter",
    daysAgo: 41, stage: "won", score: 91, wonValue: 16800, appointmentDays: -38, appointmentHour: 10,
    summary: "Full asphalt roof replacement for a 22-year-old roof on a detached house in Guelph, wants it done before winter.",
    script: [
      { k: "in", t: "Hi, our roof is about 22 years old and we're starting to see curling shingles. We'd like a quote for a full replacement before winter. We're in Guelph.", m: 0 },
      { k: "out:first", t: "Hi Priya,\n\nthanks for reaching out to Evergreen Roofing about a roof replacement in Guelph. A 22-year-old roof with curling shingles is right at the age where replacement makes sense. What's the address of the property so we can confirm it's in our service area?\n\n— Evergreen Roofing", m: 1 },
      { k: "in", t: "88 Woodlawn Rd W. It's a detached two-storey house.", m: 34 },
      { k: "out:offer", t: "Hi Priya,\n\nthanks — we have what we need to book a free on-site estimate for your roof replacement.", m: 35 },
      { k: "in", t: "2 works great", m: 52 },
      { k: "out:confirm", t: "Hi Priya,\n\nyou're all set — we've booked your visit. Our estimator will walk the roof and send a written quote the same day.", m: 53 },
    ],
  },
  {
    name: "Marcus Bell", phone: "+15195550198", email: "mbell@example.com", source: "embed", channel: "sms",
    service: "roof_repair", location: "Kitchener", address: "14 Glasgow St", propertyType: "house", urgency: "urgent", timeline: "this week",
    daysAgo: 33, stage: "won", score: 86, wonValue: 1450, appointmentDays: -32, appointmentHour: 13,
    summary: "Leak around the chimney flashing in a Kitchener house, needed repair this week.",
    script: [
      { k: "in", t: "Water dripping by the chimney when it rains. Kitchener. Need someone this week if possible", m: 0 },
      { k: "out:first", t: "Hi Marcus, thanks for reaching out to Evergreen Roofing about the leak in Kitchener. We'll move quickly on this. What's the property address? Reply STOP to opt out.", m: 1 },
      { k: "in", t: "14 Glasgow St, it's a house", m: 6 },
      { k: "out:offer", t: "Hi Marcus, thanks — we can get someone out to look at the chimney leak.", m: 7 },
      { k: "in", t: "first one", m: 9 },
      { k: "out:confirm", t: "Hi Marcus, you're all set — we've booked your visit.", m: 10 },
    ],
  },
  {
    name: "Helen Chu", email: "helen.chu@example.com", source: "form", channel: "email",
    service: "eavestrough", location: "Waterloo", address: "302 Erb St W", propertyType: "townhome", urgency: "flexible", timeline: "next month",
    daysAgo: 27, stage: "won", score: 74, wonValue: 2100, appointmentDays: -20, appointmentHour: 9, recovered: true,
    summary: "Seamless eavestrough and gutter guards for a Waterloo townhome; went quiet, re-engaged after the 72-hour follow-up.",
    script: [
      { k: "in", t: "Looking to replace our eavestroughs with seamless ones and add gutter guards. Waterloo townhouse. No rush, sometime next month.", m: 0 },
      { k: "out:first", t: "Hi Helen,\n\nthanks for reaching out to Evergreen Roofing about eavestroughs in Waterloo. Seamless aluminum eavestrough typically runs about $12 to $18 per linear foot installed, with guards as an add-on. What's the address of the property?\n\n— Evergreen Roofing", m: 1 },
      { k: "out:fu1", t: "Hi Helen, just following up on your eavestrough request with Evergreen Roofing. When you have a moment: what's the address of the property?\n\n— Evergreen Roofing", m: 1441 },
      { k: "out:fu2", t: "Hi Helen, Evergreen Roofing here. We'd still be glad to help with your eavestrough project — spring and fall fill up quickly. Just reply and we'll take it from there.\n\n— Evergreen Roofing", m: 4321 },
      { k: "in", t: "Sorry, busy week! It's 302 Erb St W, Waterloo. End-unit townhouse.", m: 4500 },
      { k: "out:offer", t: "Hi Helen,\n\nno problem at all — thanks. We can book a free measure-and-quote visit.", m: 4501 },
      { k: "in", t: "Option 3 please", m: 4620 },
      { k: "out:confirm", t: "Hi Helen,\n\nyou're all set — we've booked your visit.", m: 4621 },
    ],
  },
  {
    name: "Daniel Okafor", email: "d.okafor@example.com", phone: "+15195550111", source: "form", channel: "email",
    service: "emergency_tarp", location: "Cambridge", address: "9 Ainslie St N", propertyType: "house", urgency: "emergency", timeline: "today",
    daysAgo: 19, stage: "won", score: 95, wonValue: 4300, appointmentDays: -19, appointmentHour: 15,
    summary: "Tree limb punctured the roof in Cambridge during a storm; emergency tarp, then repair. Insurance claim.",
    script: [
      { k: "in", t: "A big branch came down in last night's storm and there's a hole in the roof over the kitchen. Water is coming in. 9 Ainslie St N, Cambridge. Please help ASAP.", m: 0 },
      { k: "out:first", t: "Hi Daniel,\n\nthanks for reaching out to Evergreen Roofing — we know this can't wait and we're prioritizing it. Emergency tarping is available today. Is this a house, townhome, or a commercial building?\n\n— Evergreen Roofing", m: 1 },
      { k: "in", t: "House. And yes it'll be an insurance claim", m: 4 },
      { k: "out:offer", t: "Hi Daniel,\n\nthanks — we can get a crew out today to tarp and document the damage for your adjuster.", m: 5 },
      { k: "in", t: "1", m: 6 },
      { k: "out:confirm", t: "Hi Daniel,\n\nyou're all set — the crew is booked. Move valuables away from the leak and put a bucket under it until we arrive.", m: 7 },
    ],
  },
  {
    name: "Sofia Martins", email: "sofia.m@example.com", source: "api", channel: "email",
    service: "roof_inspection", location: "Fergus", address: "21 St Andrew St W", propertyType: "house", urgency: "soon", timeline: "within 2 weeks",
    daysAgo: 12, stage: "won", score: 77, wonValue: 295, appointmentDays: -9, appointmentHour: 11,
    summary: "Pre-listing roof inspection for a house in Fergus, needed within two weeks.",
    script: [
      { k: "in", t: "We're listing our house in Fergus and the realtor recommended a roof inspection report. Need it within 2 weeks. 21 St Andrew St W.", m: 0 },
      { k: "out:first", t: "Hi Sofia,\n\nthanks for reaching out to Evergreen Roofing about a roof inspection in Fergus. Our detailed inspections include a written photo report for $295. Is this a house, townhome, or a commercial building?\n\n— Evergreen Roofing", m: 1 },
      { k: "in", t: "Detached house", m: 18 },
      { k: "out:offer", t: "Hi Sofia,\n\nthanks — we can book your inspection.", m: 19 },
      { k: "in", t: "Thursday works", m: 40 },
      { k: "out:confirm", t: "Hi Sofia,\n\nyou're all set — we've booked your inspection.", m: 41 },
    ],
  },
  // ---------------------------------------------------------------- BOOKED (upcoming)
  {
    name: "Tom Becker", email: "tom.becker@example.com", phone: "+15195550177", source: "form", channel: "sms",
    service: "roof_replacement", location: "Elora", address: "5 Mill St E", propertyType: "house", roofAge: "25 years", urgency: "soon", timeline: "this fall",
    daysAgo: 4, stage: "booked", score: 88, appointmentDays: 2, appointmentHour: 10,
    summary: "Replacement quote for a 25-year-old roof on an Elora house; interested in metal vs asphalt.",
    script: [
      { k: "in", t: "Roof is 25 yrs old, thinking metal vs asphalt. House in Elora. Would like it done this fall. Do you offer financing?", m: 0 },
      { k: "out:first", t: "Hi Tom, thanks for reaching out to Evergreen Roofing about a roof replacement in Elora. Financing is available for replacements over $5,000 with terms from 12 to 120 months on approved credit. What's the property address? Reply STOP to opt out.", m: 1 },
      { k: "in", t: "5 Mill St E", m: 25 },
      { k: "out:offer", t: "Hi Tom, thanks — we can book a free estimate and bring metal and asphalt samples.", m: 26 },
      { k: "in", t: "2", m: 31 },
      { k: "out:confirm", t: "Hi Tom, you're all set — we've booked your visit.", m: 32 },
    ],
  },
  {
    name: "Aisha Rahman", email: "aisha.rahman@example.com", phone: "+15195550133", source: "embed", channel: "email",
    service: "skylight", location: "Guelph", address: "61 Water St", propertyType: "house", urgency: "urgent", timeline: "this week",
    daysAgo: 2, stage: "booked", score: 84, appointmentDays: 1, appointmentHour: 14,
    summary: "Skylight leaking in the kitchen of a Guelph house; wants it fixed this week.",
    script: [
      { k: "in", t: "Our kitchen skylight started leaking during the rain yesterday. 61 Water St, Guelph. Can someone look at it this week?", m: 0 },
      { k: "out:first", t: "Hi Aisha,\n\nthanks for reaching out to Evergreen Roofing about the skylight in Guelph. We'll move quickly on this. Is this a house, townhome, or a commercial building?\n\n— Evergreen Roofing", m: 1 },
      { k: "in", t: "It's a house", m: 12 },
      { k: "out:offer", t: "Hi Aisha,\n\nthanks — we can get someone out to look at the skylight.", m: 13 },
      { k: "in", t: "The first one please", m: 20 },
      { k: "out:confirm", t: "Hi Aisha,\n\nyou're all set — we've booked your visit.", m: 21 },
    ],
  },
  {
    name: "Greg Thompson", company: "Thompson Auto Body", email: "greg@example.com", phone: "+15195550164", source: "api", channel: "email",
    service: "flat_roof", location: "Cambridge", address: "450 Hespeler Rd", propertyType: "commercial", urgency: "soon", timeline: "next month",
    daysAgo: 6, stage: "booked", score: 81, appointmentDays: 4, appointmentHour: 9, assignedToEstimator: true,
    summary: "Flat roof membrane replacement for a commercial auto body shop in Cambridge.",
    script: [
      { k: "in", t: "Our shop's flat roof (approx 4,000 sq ft) has a few soft spots and ponding. Looking to replace the membrane next month. 450 Hespeler Rd, Cambridge.", m: 0 },
      { k: "out:first", t: "Hi Greg,\n\nthanks for reaching out to Evergreen Roofing about the flat roof in Cambridge. We install EPDM and TPO membrane systems for commercial buildings. Roughly how old is the current roof?\n\n— Evergreen Roofing", m: 1 },
      { k: "in", t: "About 18 years", m: 95 },
      { k: "out:offer", t: "Hi Greg,\n\nthanks — we can book a site visit with our estimator.", m: 96 },
      { k: "in", t: "3", m: 130 },
      { k: "out:confirm", t: "Hi Greg,\n\nyou're all set — we've booked the site visit.", m: 131 },
    ],
  },
  {
    name: "Natalie Gagnon", email: "natalie.g@example.com", phone: "+15195550129", source: "form", channel: "sms",
    service: "roof_repair", location: "Rockwood", address: "112 Main St N", propertyType: "house", urgency: "urgent", timeline: "tomorrow",
    daysAgo: 1, stage: "booked", score: 89, appointmentDays: 1, appointmentHour: 11, recovered: false,
    summary: "Wind blew off shingles on a Rockwood house; wants it patched before more rain.",
    script: [
      { k: "in", t: "Wind took off a bunch of shingles on the back slope. Rockwood. Rain coming tomorrow!", m: 0 },
      { k: "out:first", t: "Hi Natalie, thanks for reaching out to Evergreen Roofing about the shingle damage in Rockwood. We'll move quickly on this. What's the property address? Reply STOP to opt out.", m: 1 },
      { k: "in", t: "112 Main St N. house", m: 3 },
      { k: "out:offer", t: "Hi Natalie, thanks — we can get someone out before the rain.", m: 4 },
      { k: "in", t: "1 please", m: 5 },
      { k: "out:confirm", t: "Hi Natalie, you're all set — we've booked your visit.", m: 6 },
    ],
  },
  // ---------------------------------------------------------------- BOOKING (times offered)
  {
    name: "Kevin Walsh", email: "kevin.walsh@example.com", source: "form", channel: "email",
    service: "roof_repair", location: "Waterloo", address: "77 King St N", propertyType: "house", urgency: "soon", timeline: "next week",
    daysAgo: 0, stage: "booking", score: 79, pendingFollowUps: 3,
    summary: "Missing ridge cap shingles on a Waterloo house, wants repair next week.",
    script: [
      { k: "in", t: "A few ridge cap shingles are missing on our house at 77 King St N in Waterloo. Would like it fixed next week.", m: 0 },
      { k: "out:first", t: "Hi Kevin,\n\nthanks for reaching out to Evergreen Roofing about the ridge cap repair in Waterloo. Is this a house, townhome, or a commercial building?\n\n— Evergreen Roofing", m: 1 },
      { k: "in", t: "Detached house", m: 45 },
      { k: "out:offer", t: "Hi Kevin,\n\nthanks — we have what we need to book a visit for your roof repair.", m: 46 },
    ],
  },
  {
    name: "Laura Fischer", phone: "+15195550188", source: "sms", channel: "sms",
    service: "eavestrough", location: "Kitchener", address: "230 Victoria St S", propertyType: "house", urgency: "soon", timeline: "this month",
    daysAgo: 1, stage: "booking", score: 72, pendingFollowUps: 2,
    summary: "Overflowing eavestroughs on a Kitchener house; needs replacement this month.",
    script: [
      { k: "in", t: "Hi, my eavestroughs overflow every time it rains. House at 230 Victoria St S Kitchener. Looking to replace this month.", m: 0 },
      { k: "out:offer", t: "Hi Laura, thanks for reaching out to Evergreen Roofing — we can book a free measure-and-quote visit. Reply STOP to opt out.", m: 1 },
      { k: "out:fu1", t: "Hi Laura, just following up on your eavestrough request with Evergreen Roofing. Do any of the times we sent work for you?", m: 1441 },
    ],
  },
  // ---------------------------------------------------------------- HOT
  {
    name: "Ben Ostrowski", email: "ben.o@example.com", phone: "+15195550155", source: "form", channel: "email",
    service: "roof_replacement", location: "Guelph", address: "19 Paisley Rd", propertyType: "house", roofAge: "30 years", urgency: "urgent", timeline: "as soon as possible",
    daysAgo: 0, stage: "hot", score: 87, control: "human", assignedToEstimator: true,
    summary: "Multiple leaks on a 30-year-old roof in Guelph; ready to replace ASAP. Asked to speak with someone about metal options.",
    script: [
      { k: "in", t: "Our roof is 30 years old and we've had two leaks this month. We want to replace it ASAP. 19 Paisley Rd, Guelph — detached house. Can someone call me about metal roofing options?", m: 0 },
      { k: "out:hold", t: "Hi Ben,\n\nthanks for your message. I've passed this to our team and someone will personally follow up with you shortly.\n\n— Evergreen Roofing", m: 1 },
      { k: "note", t: "Called Ben — wants standing seam metal. Booking a site visit with samples. — Jordan", m: 40 },
    ],
  },
  {
    name: "Chloe Bennett", email: "chloe.bennett@example.com", source: "embed", channel: "email",
    service: "roof_repair", location: "Erin", address: "8 Church Blvd", propertyType: "house", urgency: "urgent", timeline: "this week",
    daysAgo: 2, stage: "hot", score: 82,
    summary: "Ceiling stain spreading under a suspected flashing leak in Erin; wants repair this week.",
    script: [
      { k: "in", t: "There's a brown stain on our bedroom ceiling that's getting bigger. Probably the flashing. House at 8 Church Blvd, Erin. Need it fixed this week. Do I need to be home?", m: 0 },
      { k: "out:first", t: "Hi Chloe,\n\nthanks for reaching out to Evergreen Roofing about the leak in Erin. We'll move quickly on this. If there is an interior leak, we ask that someone be home so we can see the ceiling and attic.\n\n— Evergreen Roofing", m: 1 },
    ],
  },
  // ---------------------------------------------------------------- QUALIFIED
  {
    name: "Ravi Patel", email: "ravi.patel@example.com", source: "form", channel: "email",
    service: "roof_replacement", location: "Waterloo", address: "15 Albert St", propertyType: "house", roofAge: "18 years", urgency: "flexible", timeline: "next spring",
    daysAgo: 5, stage: "qualified", score: 58, pendingFollowUps: 2,
    summary: "Planning a replacement next spring for an 18-year-old roof in Waterloo; early research stage.",
    script: [
      { k: "in", t: "Planning ahead — we'll probably replace our roof next spring. 18 years old, house at 15 Albert St, Waterloo. Roughly what does a replacement cost?", m: 0 },
      { k: "out:first", t: "Hi Ravi,\n\nthanks for reaching out to Evergreen Roofing about a roof replacement in Waterloo. Asphalt shingle replacements typically range from $11,000 to $22,000 for an average home in our area. Would you like us to set up a time to take a look?\n\n— Evergreen Roofing", m: 1 },
      { k: "out:fu1", t: "Hi Ravi, just following up on your roof replacement request with Evergreen Roofing. Is this still something we can help with?\n\n— Evergreen Roofing", m: 1441 },
    ],
  },
  {
    name: "Emily Zhang", email: "emily.zhang@example.com", phone: "+15195550120", source: "form", channel: "sms",
    service: "roof_inspection", location: "Kitchener", address: "40 Queen St S", propertyType: "townhome", urgency: "flexible", timeline: "within a month",
    daysAgo: 8, stage: "qualified", score: 63, pendingFollowUps: 1,
    summary: "Maintenance inspection for a Kitchener townhome; flexible on timing.",
    script: [
      { k: "in", t: "Would like a roof inspection for our townhouse at 40 Queen St S, Kitchener. Sometime within a month is fine.", m: 0 },
      { k: "out:first", t: "Hi Emily, thanks for reaching out to Evergreen Roofing about an inspection in Kitchener. Roughly how old is the roof? Reply STOP to opt out.", m: 1 },
      { k: "in", t: "Not sure, maybe 12-15 years", m: 300 },
      { k: "out:ask", t: "Hi Emily, thanks for the details. Would you like us to set up a time to take a look?", m: 301 },
      { k: "out:fu1", t: "Hi Emily, just following up on your inspection request with Evergreen Roofing. Want me to send a few open times?", m: 1741 },
      { k: "out:fu2", t: "Hi Emily, Evergreen Roofing here. Happy to help with that inspection whenever suits — just reply and we'll take it from there.", m: 4621 },
    ],
  },
  {
    name: "Owen MacLeod", email: "owen.macleod@example.com", source: "webhook", channel: "email",
    service: "eavestrough", location: "Ayr", address: "3 Stanley St", propertyType: "house", urgency: "flexible", timeline: "this fall",
    daysAgo: 14, stage: "qualified", score: 52,
    summary: "Gutter guards for a house in Ayr; price shopping between a few companies.",
    script: [
      { k: "in", t: "Getting quotes from a few companies for gutter guards on our house in Ayr (3 Stanley St). What's your best price?", m: 0 },
      { k: "out:first", t: "Hi Owen,\n\nthanks for reaching out to Evergreen Roofing about gutter guards in Ayr. Seamless eavestrough typically runs about $12 to $18 per linear foot installed, with guards as an add-on. When are you hoping to have the work done?\n\n— Evergreen Roofing", m: 1 },
      { k: "in", t: "This fall sometime", m: 600 },
      { k: "out:ask", t: "Hi Owen,\n\nthanks for the details. Would you like us to set up a time to take a look?\n\n— Evergreen Roofing", m: 601 },
    ],
  },
  // ---------------------------------------------------------------- QUALIFYING
  {
    name: "Jasmine Cole", email: "jasmine.cole@example.com", phone: "+15195550109", source: "form", channel: "email",
    service: "roof_repair", location: "Guelph", urgency: "urgent", timeline: "this week",
    daysAgo: 0, stage: "qualifying", score: 64, pendingFollowUps: 3,
    summary: "Roof leak over the garage in Guelph; needs repair this week.",
    script: [
      { k: "in", t: "Hi — our garage roof is leaking and it's getting worse. We're in Guelph. Can someone come out this week?", m: 0 },
      { k: "out:first", t: "Hi Jasmine,\n\nthanks for reaching out to Evergreen Roofing about the roof leak in Guelph. We'll move quickly on this. What's the address of the property so we can confirm it's in our service area?\n\n— Evergreen Roofing", m: 1 },
    ],
  },
  {
    name: "Mateo Alvarez", phone: "+15195550171", source: "sms", channel: "sms",
    service: "roof_replacement", location: "Cambridge", urgency: "soon",
    daysAgo: 3, stage: "qualifying", score: 49, pendingFollowUps: 2, recovered: false,
    summary: "Interested in a new roof for a home in Cambridge; address and timing still needed.",
    script: [
      { k: "in", t: "How much for a new roof? Cambridge", m: 0 },
      { k: "out:first", t: "Hi, thanks for reaching out to Evergreen Roofing about a roof replacement in Cambridge. Asphalt replacements typically range from $11,000 to $22,000 — the estimate is free. What's the property address? Reply STOP to opt out.", m: 1 },
      { k: "out:fu1", t: "Hi, just following up on your roof replacement request with Evergreen Roofing. When you have a moment: what's the address of the property?", m: 1441 },
    ],
  },
  {
    name: "Grace Liu", email: "grace.liu@example.com", source: "form", channel: "email",
    service: "skylight", location: "Breslau", address: "27 Woolwich St", urgency: "soon", timeline: "next week",
    daysAgo: 6, stage: "qualifying", score: 55, recovered: true,
    summary: "Skylight condensation and a small drip in Breslau; replied after the first follow-up.",
    script: [
      { k: "in", t: "Our skylight has condensation and a small drip near the frame. 27 Woolwich St, Breslau. Would like someone next week.", m: 0 },
      { k: "out:first", t: "Hi Grace,\n\nthanks for reaching out to Evergreen Roofing about the skylight in Breslau. Is this a house, townhome, or a commercial building?\n\n— Evergreen Roofing", m: 1 },
      { k: "out:fu1", t: "Hi Grace, just following up on your skylight request with Evergreen Roofing. When you have a moment: is this a house, townhome, or a commercial building?\n\n— Evergreen Roofing", m: 1441 },
      { k: "in", t: "Sorry for the delay — townhouse, end unit. Is the skylight covered under warranty if you installed it?", m: 1600 },
      { k: "out:ask", t: "Hi Grace,\n\nthanks for the details. Repairs carry a 2-year workmanship warranty and replacements a 10-year workmanship warranty — the team will confirm whether your skylight is still covered.\n\n— Evergreen Roofing", m: 1601 },
    ],
  },
  {
    name: "Liam O'Connor", email: "liam.oconnor@example.com", source: "embed", channel: "email",
    service: "roof_inspection", location: "Puslinch", urgency: "flexible",
    daysAgo: 9, stage: "qualifying", score: 41,
    summary: "General roof check for a property in Puslinch; hasn't replied to the address question.",
    script: [
      { k: "in", t: "Can you check our roof? Puslinch area. Nothing urgent.", m: 0 },
      { k: "out:first", t: "Hi Liam,\n\nthanks for reaching out to Evergreen Roofing about a roof inspection in Puslinch. What's the address of the property?\n\n— Evergreen Roofing", m: 1 },
      { k: "out:fu1", t: "Hi Liam, just following up on your inspection request with Evergreen Roofing. When you have a moment: what's the address of the property?\n\n— Evergreen Roofing", m: 1441 },
      { k: "out:fu2", t: "Hi Liam, Evergreen Roofing here. We'd still be glad to help with that inspection — catching issues early usually keeps the fix simpler.\n\n— Evergreen Roofing", m: 4321 },
    ],
  },
  // ---------------------------------------------------------------- NEW / CONTACTED
  {
    name: "Hannah Weiss", email: "hannah.weiss@example.com", source: "form", channel: "email",
    service: "eavestrough", location: "Acton", urgency: "unknown",
    daysAgo: 0, stage: "contacted", score: 46, pendingFollowUps: 3,
    summary: "Downspout pulled away from the wall on a property in Acton.",
    script: [
      { k: "in", t: "One of our downspouts pulled away from the wall. We're in Acton.", m: 0 },
      { k: "out:first", t: "Hi Hannah,\n\nthanks for reaching out to Evergreen Roofing about the downspout in Acton. What's the address of the property?\n\n— Evergreen Roofing", m: 1 },
    ],
  },
  {
    name: "Victor Nguyen", email: "victor.nguyen@example.com", phone: "+15195550147", source: "api", channel: "sms",
    service: null, location: "Kitchener", urgency: "unknown",
    daysAgo: 0, stage: "new", score: 0,
    summary: "New inquiry from Kitchener — waiting for Signal to process.",
    script: [{ k: "in", t: "Hi there, do you do attic insulation along with roofing? Kitchener.", m: 0 }],
  },
  // ---------------------------------------------------------------- NEEDS HUMAN
  {
    name: "Robert Hayes", email: "rhayes@example.com", phone: "+15195550190", source: "email", channel: "email",
    service: "roof_repair", location: "Guelph", address: "250 Gordon St", propertyType: "house", urgency: "urgent",
    daysAgo: 1, stage: "needs_human", score: 61, control: "autopilot",
    handoffReason: "Customer is upset",
    summary: "Existing customer reporting a leak near last year's repair; frustrated about waiting. Needs a personal call.",
    script: [
      { k: "in", t: "You guys repaired our roof last year and it's leaking AGAIN in the same spot. This is unacceptable. 250 Gordon St. I want someone to call me today.", m: 0 },
      { k: "out:hold", t: "Hi Robert,\n\nthanks for your message. I've passed this to our team and someone will personally follow up with you shortly.\n\n— Evergreen Roofing", m: 1 },
    ],
  },
  // ---------------------------------------------------------------- LOST
  {
    name: "Sarah Kim", email: "sarah.kim@example.com", source: "form", channel: "email",
    service: "roof_replacement", location: "Waterloo", address: "9 Bridgeport Rd E", propertyType: "house", urgency: "flexible", timeline: "next year",
    daysAgo: 30, stage: "lost", score: 38, lostReason: "Went with another contractor",
    summary: "Replacement inquiry in Waterloo; chose another contractor.",
    script: [
      { k: "in", t: "Looking for a roof replacement quote for next year. 9 Bridgeport Rd E, Waterloo.", m: 0 },
      { k: "out:first", t: "Hi Sarah,\n\nthanks for reaching out to Evergreen Roofing about a roof replacement in Waterloo. Is this a house, townhome, or a commercial building?\n\n— Evergreen Roofing", m: 1 },
      { k: "in", t: "House. Actually we already went with someone else, thanks anyway.", m: 2000 },
      { k: "out:close", t: "Hi Sarah,\n\nno problem at all — thanks for letting us know. If anything changes, just reply here and we'll be happy to help.\n\n— Evergreen Roofing", m: 2001 },
    ],
  },
  {
    name: "Paul Dubois", email: "paul.dubois@example.com", source: "form", channel: "email",
    service: "roof_repair", location: "Toronto", urgency: "soon",
    daysAgo: 22, stage: "lost", score: 18, lostReason: "Outside service area",
    summary: "Roof repair request in Toronto — outside the service area.",
    script: [
      { k: "in", t: "Need a roof repair at our place in Toronto, near the Danforth. Can you come next week?", m: 0 },
      { k: "out:first", t: "Hi Paul,\n\nthanks for thinking of Evergreen Roofing. This request may be outside the area we normally serve, so a team member will review it and confirm whether we can help.\n\n— Evergreen Roofing", m: 1 },
      { k: "staff", t: "Hi Paul, unfortunately Toronto is outside our service area. We'd recommend checking with a local Toronto roofer. Sorry we can't help this time! — Alex", m: 120 },
    ],
  },
  {
    name: "Mike Fraser", email: "mike.fraser@example.com", source: "form", channel: "email",
    service: "eavestrough", location: "Guelph", urgency: "flexible",
    daysAgo: 35, stage: "lost", score: 22, lostReason: "No response after follow-ups",
    summary: "Eavestrough cleaning inquiry in Guelph; never replied after three follow-ups.",
    script: [
      { k: "in", t: "Do you clean eavestroughs? Guelph", m: 0 },
      { k: "out:first", t: "Hi Mike,\n\nthanks for reaching out to Evergreen Roofing about your eavestroughs in Guelph. What's the address of the property?\n\n— Evergreen Roofing", m: 1 },
      { k: "out:fu1", t: "Hi Mike, just following up on your eavestrough request with Evergreen Roofing. When you have a moment: what's the address of the property?\n\n— Evergreen Roofing", m: 1441 },
      { k: "out:fu2", t: "Hi Mike, Evergreen Roofing here. We'd still be glad to help — just reply and we'll take it from there.\n\n— Evergreen Roofing", m: 4321 },
      { k: "out:fu3", t: "Hi Mike, I don't want to keep filling your inbox — should we close out your eavestrough request? If you'd still like help, just reply any time.\n\n— Evergreen Roofing", m: 10081 },
    ],
  },
  // ---------------------------------------------------------------- SPAM
  {
    name: "Digital Growth Team", email: "growth@seo-rankers.example", source: "form", channel: "email",
    service: null, location: null, urgency: "unknown",
    daysAgo: 3, stage: "archived", score: 3, isSpam: true,
    summary: "Message looks like spam or an unrelated sales pitch.",
    script: [{ k: "in", t: "We can rank your website #1 on Google! Our SEO services increase your traffic 300%. Click here https://example.com/seo and https://example.com/offer", m: 0 }],
  },
  // ---------------------------------------------------------------- More history for analytics
  {
    name: "Irene Kowalski", email: "irene.k@example.com", source: "form", channel: "email",
    service: "roof_repair", location: "Kitchener", address: "66 Frederick St", propertyType: "house", urgency: "urgent", timeline: "this week",
    daysAgo: 24, stage: "won", score: 83, wonValue: 980, appointmentDays: -23, appointmentHour: 14,
    summary: "Vent boot leak repair for a Kitchener house.",
    script: [
      { k: "in", t: "Leak around a plumbing vent on the roof, 66 Frederick St Kitchener. House. This week please.", m: 0 },
      { k: "out:offer", t: "Hi Irene,\n\nthanks for reaching out to Evergreen Roofing — we can get someone out this week to fix the vent leak.", m: 1 },
      { k: "in", t: "2", m: 14 },
      { k: "out:confirm", t: "Hi Irene,\n\nyou're all set — we've booked your visit.", m: 15 },
    ],
  },
  {
    name: "Ahmed Siddiqui", email: "ahmed.s@example.com", phone: "+15195550118", source: "embed", channel: "sms",
    service: "roof_replacement", location: "Guelph", address: "301 Stone Rd E", propertyType: "house", roofAge: "20 years", urgency: "soon", timeline: "this fall",
    daysAgo: 16, stage: "booked", score: 85, appointmentDays: 6, appointmentHour: 13, recovered: true,
    summary: "Replacement for a 20-year-old roof in Guelph; re-engaged after a follow-up and booked an estimate.",
    script: [
      { k: "in", t: "Thinking about replacing our 20 year old roof this fall. Guelph.", m: 0 },
      { k: "out:first", t: "Hi Ahmed, thanks for reaching out to Evergreen Roofing about a roof replacement in Guelph. What's the property address? Reply STOP to opt out.", m: 1 },
      { k: "out:fu1", t: "Hi Ahmed, just following up on your roof replacement request with Evergreen Roofing. When you have a moment: what's the address of the property?", m: 1441 },
      { k: "in", t: "301 Stone Rd E. Detached house. Still interested!", m: 1700 },
      { k: "out:offer", t: "Hi Ahmed, thanks — we can book a free estimate.", m: 1701 },
      { k: "in", t: "Option 1", m: 1760 },
      { k: "out:confirm", t: "Hi Ahmed, you're all set — we've booked your visit.", m: 1761 },
    ],
  },
];
