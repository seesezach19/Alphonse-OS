import { createCustomerIngressDatabase } from "./customer-ingress-database.js";

const database = createCustomerIngressDatabase(process.env.INGRESS_DATABASE_URL);
try { await database.migrate(); } finally { await database.close(); }
