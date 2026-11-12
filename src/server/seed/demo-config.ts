import type { QualificationField, ServiceOffering } from "@/types/domain";

export const DEMO_ORG_SLUG = "evergreen-roofing";
export const DEMO_OWNER_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_ESTIMATOR_ID = "00000000-0000-4000-8000-000000000002";

export const DEMO_SERVICES: ServiceOffering[] = [
  { key: "roof_repair", name: "Roof Repair", description: "Leaks, missing or damaged shingles, flashing and vents", averageValue: 1200, enabled: true, keywords: ["leak", "leaking", "repair", "missing shingles", "shingles blew", "shingles", "damaged", "drip", "dripping", "flashing", "storm damage", "ceiling", "water coming", "coming through", "vent"] },
  { key: "roof_replacement", name: "Roof Replacement", description: "Full tear-off and re-roof in asphalt or metal", averageValue: 14500, enabled: true, keywords: ["new roof", "replace", "replacement", "re-roof", "reroof", "full roof", "metal roof", "end of its life"] },
  { key: "roof_inspection", name: "Roof Inspection", description: "Detailed inspection with photo report (home sales, insurance, maintenance)", averageValue: 350, enabled: true, keywords: ["inspection", "inspect", "inspected", "assessment", "home sale", "selling", "buying a house", "check the roof"] },
  { key: "eavestrough", name: "Eavestrough & Gutters", description: "Seamless eavestrough, downspouts and gutter guards", averageValue: 1800, enabled: true, keywords: ["eavestrough", "eaves", "gutter", "gutters", "downspout", "gutter guard"] },
  { key: "emergency_tarp", name: "Emergency Tarping", description: "Same-day temporary protection after storm or tree damage", averageValue: 650, enabled: true, keywords: ["tarp", "tree fell", "tree came down", "hole in", "caved", "storm last night", "emergency"] },
  { key: "skylight", name: "Skylight Repair", description: "Skylight leaks, reflashing and replacement", averageValue: 1500, enabled: true, keywords: ["skylight"] },
  { key: "flat_roof", name: "Flat Roofing", description: "EPDM and TPO membrane roofs for garages and commercial buildings", averageValue: 9000, enabled: true, keywords: ["flat roof", "epdm", "tpo", "membrane", "torch on"] },
];

export const DEMO_QUALIFICATION_FIELDS: QualificationField[] = [
  { key: "address", label: "Property address", question: "What's the address of the property so we can confirm it's in our service area?", required: true },
  { key: "property_type", label: "Property type", question: "Is this a house, townhome, or a commercial building?", required: true },
  { key: "timeline", label: "Timeline", question: "When are you hoping to have the work done?", required: true },
  { key: "roof_age", label: "Approximate roof age", question: "Roughly how old is the roof — do you know when it was last replaced?", required: false, services: ["roof_replacement", "roof_repair", "roof_inspection"] },
  { key: "insurance_claim", label: "Insurance claim", question: "Will this be going through an insurance claim?", required: false, services: ["emergency_tarp"] },
];

export const DEMO_SERVICE_AREA = {
  cities: ["Guelph", "Kitchener", "Waterloo", "Cambridge", "Fergus", "Elora", "Rockwood", "Puslinch", "Erin", "Acton", "Ayr", "Breslau"],
  postalPrefixes: ["N1E", "N1G", "N1H", "N1K", "N1L", "N2A", "N2B", "N2C", "N2E", "N2G", "N2H", "N2J", "N2K", "N2L", "N2M", "N2N", "N2P", "N2R", "N2T", "N2V", "N1R", "N1S", "N1T", "N3C", "N3E", "N3H", "N1M"],
  note: "Wellington County and Waterloo Region",
};

export const DEMO_KNOWLEDGE: { title: string; type: "faq" | "service" | "policy" | "business_info" | "document"; content: string }[] = [
  {
    title: "Frequently asked questions",
    type: "faq",
    content: `Q: Are your estimates free?
A: Yes. On-site estimates for repairs, replacements and eavestroughs are free with no obligation. Detailed roof inspections with a written photo report are $295.

Q: What warranty do you offer?
A: Roof replacements include a 10-year Evergreen workmanship warranty on top of the manufacturer's shingle warranty (up to 50 years with GAF Timberline HDZ). Repairs carry a 2-year workmanship warranty.

Q: Do you offer financing?
A: Yes. Financing is available for roof replacements over $5,000 through our lending partner, with terms from 12 to 120 months on approved credit.

Q: Can you help with insurance claims?
A: Yes. We document storm damage with photos and can meet your insurance adjuster on site. We do not negotiate claims on your behalf.

Q: How long does a roof replacement take?
A: Most homes are completed in one to two days. Larger or steeper roofs can take three days.

Q: Do I need to be home for the estimate?
A: Not for exterior-only estimates. If there is an interior leak, we ask that someone be home so we can see the ceiling and attic.

Q: Do you work in winter?
A: Yes, we do repairs and emergency tarping year round. Full replacements are scheduled when daytime temperatures allow shingles to seal properly, usually April to November.

Q: Are you licensed and insured?
A: Yes. Evergreen Roofing carries $5 million in liability insurance and full WSIB coverage for every crew member.`,
  },
  {
    title: "Services and pricing guidance",
    type: "service",
    content: `Roof repair: most leak and shingle repairs cost between $450 and $1,800 depending on access and materials. Final pricing is confirmed on site.

Roof replacement: asphalt shingle replacements typically range from $11,000 to $22,000 for an average home in our area. Metal roofs typically range from $24,000 to $38,000.

Eavestrough: seamless aluminum eavestrough runs about $12 to $18 per linear foot installed. Gutter guards are available as an add-on.

Emergency tarping: same-day emergency tarping starts at $450 during business hours and $650 after hours.

Flat roofing: EPDM and TPO membrane systems for garages, additions and commercial buildings. Pricing depends on square footage and existing layers.

Skylights: skylight reflashing starts at $650; full skylight replacement starts at $1,400 including the unit.`,
  },
  {
    title: "Service area",
    type: "business_info",
    content: `Evergreen Roofing serves Guelph, Kitchener, Waterloo, Cambridge, Fergus, Elora, Rockwood, Puslinch, Erin, Acton, Ayr and Breslau. We do not currently serve Toronto, Hamilton, London or the GTA. Jobs just outside the area may be possible for full replacements — the office confirms these case by case.`,
  },
  {
    title: "Booking, deposits and cancellations",
    type: "policy",
    content: `Estimates are booked in 60-minute windows Monday to Friday 8 AM to 5 PM and Saturday 9 AM to 1 PM. Roof replacements require a 15% deposit to reserve an install date, with the balance due on completion. Customers can reschedule estimates any time at no charge. Install dates can be moved without penalty with at least 72 hours' notice; deposits are fully refundable up to 7 days before the install date.`,
  },
  {
    title: "Business hours and emergencies",
    type: "business_info",
    content: `Office hours are Monday to Friday 8 AM to 5 PM and Saturday 9 AM to 1 PM. Emergency tarping is available 7 days a week, including evenings, for active leaks and storm damage. If water is actively coming in, customers should move valuables, place a bucket under the leak and, if safe, poke a small hole in a bulging ceiling to release water.`,
  },
  {
    title: "Staff instructions for the assistant",
    type: "document",
    content: `Never quote an exact price for a specific job — share the typical range and explain the estimate is free. Never promise a same-day visit except for emergency tarping. Commercial contracts over $50,000 and property management companies should be handed to Jordan (estimator). Always offer the next available estimate times once we have the address, property type and timeline.`,
  },
];
