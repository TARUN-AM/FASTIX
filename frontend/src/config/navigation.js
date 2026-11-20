import { USER_ROLES, ALL_AUTHENTICATED_ROLES } from "./constants";

/**
 * Navigation items aligned with ARCHITECTURE.md section 8.
 * Prompt 5 will filter these items dynamically using the logged-in user's role.
 */
export const NAV_ITEMS = Object.freeze([
  {
    label: "Home",
    path: "/",
    allowedRoles: [USER_ROLES.PUBLIC, ...ALL_AUTHENTICATED_ROLES],
    area: "customer",
  },
  {
    label: "Events",
    path: "/events",
    allowedRoles: [USER_ROLES.PUBLIC, ...ALL_AUTHENTICATED_ROLES],
    area: "customer",
  },
  {
    label: "Resale Marketplace",
    path: "/resale",
    allowedRoles: [USER_ROLES.PUBLIC, ...ALL_AUTHENTICATED_ROLES],
    area: "customer",
  },
  {
    label: "My Tickets",
    path: "/my-tickets",
    allowedRoles: [...ALL_AUTHENTICATED_ROLES],
    area: "customer",
  },
  {
    label: "Verify Identity",
    path: "/verify-identity",
    allowedRoles: [...ALL_AUTHENTICATED_ROLES],
    area: "verification",
  },
  {
    label: "Gate Scanner",
    path: "/gate/scanner",
    allowedRoles: [USER_ROLES.GATE_STAFF, USER_ROLES.ADMIN],
    area: "staff",
  },
  {
    label: "Organizer",
    path: "/organizer",
    allowedRoles: [USER_ROLES.ORGANIZER, USER_ROLES.ADMIN],
    area: "organizer",
  },
  {
    label: "Admin",
    path: "/admin",
    allowedRoles: [USER_ROLES.ADMIN],
    area: "admin",
  },
]);

/**
 * Primary public and customer links displayed in the Navbar before Prompt 5
 * introduces authentication and role-based filtering.
 */
export const PUBLIC_CUSTOMER_NAV_ITEMS = Object.freeze(
  NAV_ITEMS.filter((item) => item.area === "customer")
);
