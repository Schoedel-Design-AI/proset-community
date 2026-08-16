import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

let serviceAccount: any = null;
const credPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credPath && fs.existsSync(credPath)) {
  try {
    serviceAccount = JSON.parse(fs.readFileSync(credPath, "utf8"));
  } catch (err) {
    console.error("Failed to parse Firebase service account JSON from path:", credPath, err);
  }
}

const hasFirebaseCreds = !!(
  serviceAccount ||
  (process.env.FIREBASE_PROJECT_ID &&
   process.env.FIREBASE_CLIENT_EMAIL &&
   process.env.FIREBASE_PRIVATE_KEY)
);

// Global in-memory DB fallback
const localDb = new Map<string, Map<string, any>>();
const MOCK_DB_PATH = path.join(process.cwd(), "audio-uploads", "mock-db.json");

function loadMockDb() {
  try {
    if (fs.existsSync(MOCK_DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(MOCK_DB_PATH, "utf8"));
      for (const [colName, docs] of Object.entries(data)) {
        const colMap = new Map();
        for (const [id, doc] of Object.entries(docs as any)) {
          colMap.set(id, doc);
        }
        localDb.set(colName, colMap);
      }
      console.log("Mock database loaded successfully from", MOCK_DB_PATH);
    }
  } catch (err) {
    console.error("Failed to load mock DB:", err);
  }
}

function saveMockDb() {
  try {
    const dir = path.dirname(MOCK_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: any = {};
    for (const [colName, colMap] of localDb.entries()) {
      data[colName] = {};
      for (const [id, doc] of colMap.entries()) {
        data[colName][id] = doc;
      }
    }
    fs.writeFileSync(MOCK_DB_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save mock DB:", err);
  }
}

// Ensure mock db is initialized
loadMockDb();

// Initialize Firestore if credentials exist or running in GCP environment
let firestore: any = null;
const isGcpEnvironment = !!(
  process.env.K_SERVICE ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.NODE_ENV === "production"
);

if (hasFirebaseCreds || isGcpEnvironment) {
  if (!getApps().length) {
    if (hasFirebaseCreds) {
      const cred = serviceAccount
        ? cert(serviceAccount)
        : cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
          });
      initializeApp({
        credential: cred,
      });
    } else {
      // In GCP (Cloud Run), initializeApp() uses Application Default Credentials
      initializeApp();
    }
  }
  firestore = getFirestore();
  console.log("Firestore initialized successfully.");
} else {
  console.warn("WARNING: Firebase credentials are not set. Using local in-memory document store.");
}

// Table name extractor
export function getTableName(table: any): string {
  if (typeof table === "string") return table;
  if (table && table._ && table._.name) return table._.name;
  const syms = Object.getOwnPropertySymbols(table);
  for (const sym of syms) {
    if (sym.toString().includes("Name")) {
      return (table as any)[sym];
    }
  }
  if (table && table.name) return table.name;
  return "unknown";
}

// Condition Parsers
function parseDrizzleCondition(cond: any): any {
  if (!cond) return null;

  if (cond.queryChunks) {
    const chunks = cond.queryChunks;
    const hasAnd = chunks.some(
      (c: any) => typeof c.value === "string" && c.value.toLowerCase().includes(" and ")
    );
    const hasOr = chunks.some(
      (c: any) => typeof c.value === "string" && c.value.toLowerCase().includes(" or ")
    );

    if (hasAnd) {
      const subConditions = chunks
        .filter((c: any) => c.queryChunks || (c.constructor && c.constructor.name === "SQL"))
        .map((c: any) => parseDrizzleCondition(c))
        .filter(Boolean);
      return { type: "and", conditions: subConditions };
    }
    if (hasOr) {
      const subConditions = chunks
        .filter((c: any) => c.queryChunks || (c.constructor && c.constructor.name === "SQL"))
        .map((c: any) => parseDrizzleCondition(c))
        .filter(Boolean);
      return { type: "or", conditions: subConditions };
    }

    let column: string | null = null;
    let operator = "==";
    let value: any = null;

    for (const chunk of chunks) {
      if (chunk && typeof chunk === "object" && "name" in chunk && "table" in chunk) {
        column = chunk.name;
      } else if (chunk && typeof chunk === "object" && "value" in chunk) {
        value = chunk.value;
      } else if (chunk && typeof chunk.value === "string") {
        const opStr = chunk.value.toLowerCase();
        if (opStr.includes(">=")) {
          operator = ">=";
        } else if (opStr.includes("<=")) {
          operator = "<=";
        } else if (opStr.includes(">")) {
          operator = ">";
        } else if (opStr.includes("<")) {
          operator = "<";
        } else if (opStr.includes("<>") || opStr.includes("!=")) {
          operator = "!=";
        } else if (opStr.includes("is null")) {
          operator = "isNull";
        } else if (opStr.includes("is not null")) {
          operator = "isNotNull";
        } else if (opStr.includes(" ilike ") || opStr.includes(" like ")) {
          operator = "ilike";
        } else if (opStr.includes(" in ")) {
          operator = "in";
        }
      } else if (
        typeof chunk === "string" ||
        typeof chunk === "number" ||
        typeof chunk === "boolean"
      ) {
        value = chunk;
      }
    }

    if (column) {
      return { type: "simple", column, operator, value };
    }
  }
  return null;
}

function parseOrderBy(order: any): { column: string; direction: "asc" | "desc" } | null {
  if (!order) return null;
  if (order.queryChunks) {
    let column: string | null = null;
    let direction: "asc" | "desc" = "asc";
    for (const chunk of order.queryChunks) {
      if (chunk && typeof chunk === "object" && "name" in chunk && "table" in chunk) {
        column = chunk.name;
      } else if (chunk && typeof chunk.value === "string") {
        if (chunk.value.toLowerCase().includes("desc")) {
          direction = "desc";
        }
      }
    }
    if (column) {
      return { column, direction };
    }
  }
  return null;
}

function matchesCondition(doc: any, cond: any): boolean {
  if (!cond) return true;
  if (cond.type === "and") {
    return cond.conditions.every((c: any) => matchesCondition(doc, c));
  }
  if (cond.type === "or") {
    return cond.conditions.some((c: any) => matchesCondition(doc, c));
  }

  const { column, operator, value } = cond;
  const docVal = doc[column];

  if (operator === "==") {
    return docVal === value;
  }
  if (operator === "!=") {
    return docVal !== value;
  }
  if (operator === ">") {
    return docVal > value;
  }
  if (operator === ">=") {
    return docVal >= value;
  }
  if (operator === "<") {
    return docVal < value;
  }
  if (operator === "<=") {
    return docVal <= value;
  }
  if (operator === "isNull") {
    return docVal === null || docVal === undefined;
  }
  if (operator === "isNotNull") {
    return docVal !== null && docVal !== undefined;
  }
  if (operator === "ilike") {
    if (typeof docVal !== "string" || typeof value !== "string") return false;
    const cleanPattern = value.replace(/%/g, "").toLowerCase();
    return docVal.toLowerCase().includes(cleanPattern);
  }
  if (operator === "in") {
    if (!Array.isArray(value)) return false;
    return value.includes(docVal);
  }
  return false;
}

// Low-level database document operations
async function getAllDocs(collectionName: string): Promise<any[]> {
  if (firestore) {
    const snap = await firestore.collection(collectionName).get();
    return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  } else {
    const colMap = localDb.get(collectionName);
    if (!colMap) return [];
    return Array.from(colMap.values());
  }
}

async function writeDoc(collectionName: string, id: string, data: any): Promise<void> {
  // Normalize timestamps/dates to ISO strings to avoid serialization issues
  const normalized = { ...data };
  for (const [k, v] of Object.entries(normalized)) {
    if (v instanceof Date) {
      normalized[k] = v.toISOString();
    }
  }

  if (firestore) {
    await firestore.collection(collectionName).doc(id).set(normalized, { merge: true });
  } else {
    const colMap = localDb.get(collectionName) || new Map();
    const existing = colMap.get(id) || {};
    const updated = { ...existing, ...normalized, id };
    colMap.set(id, updated);
    localDb.set(collectionName, colMap);
    saveMockDb();
  }
}

async function deleteDoc(collectionName: string, id: string): Promise<void> {
  if (firestore) {
    await firestore.collection(collectionName).doc(id).delete();
  } else {
    const colMap = localDb.get(collectionName);
    if (colMap) {
      colMap.delete(id);
      saveMockDb();
    }
  }
}

// Core Query Execution Engine
async function executeQuery(builder: QueryBuilder): Promise<any> {
  const table = builder.tableName;
  const action = builder.action;
  
  if (action === "insert") {
    const values = Array.isArray(builder.valuesToSet) ? builder.valuesToSet : [builder.valuesToSet];
    const results = [];
    for (const val of values) {
      const id = val.id || `doc-${Math.random().toString(36).substr(2, 9)}`;
      const docData = { ...val, id };
      await writeDoc(table, id, docData);
      results.push(docData);
    }
    return results;
  }

  if (action === "update") {
    // 1. Fetch matches
    let docs = await getAllDocs(table);
    const parsedConds = builder.conditions.map(parseDrizzleCondition).filter(Boolean);
    if (parsedConds.length > 0) {
      docs = docs.filter((doc) => parsedConds.every((c) => matchesCondition(doc, c)));
    }

    const results = [];
    for (const doc of docs) {
      const updated = { ...doc, ...builder.valuesToSet };
      await writeDoc(table, doc.id, updated);
      results.push(updated);
    }
    return results;
  }

  if (action === "delete") {
    let docs = await getAllDocs(table);
    const parsedConds = builder.conditions.map(parseDrizzleCondition).filter(Boolean);
    if (parsedConds.length > 0) {
      docs = docs.filter((doc) => parsedConds.every((c) => matchesCondition(doc, c)));
    }

    for (const doc of docs) {
      await deleteDoc(table, doc.id);
    }
    return docs; // Drizzle returns deleted records on delete returning()
  }

  // Action SELECT
  let docs = await getAllDocs(table);

  // Apply conditions
  const parsedConds = builder.conditions.map(parseDrizzleCondition).filter(Boolean);
  if (parsedConds.length > 0) {
    docs = docs.filter((doc) => parsedConds.every((c) => matchesCondition(doc, c)));
  }

  // Apply sorting
  if (builder.orderByVal && builder.orderByVal.length > 0) {
    const orders = builder.orderByVal.map(parseOrderBy).filter(Boolean);
    docs.sort((a, b) => {
      for (const order of orders) {
        const { column, direction } = order!;
        const valA = a[column];
        const valB = b[column];
        if (valA === valB) continue;
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        
        const comparison = valA < valB ? -1 : 1;
        return direction === "asc" ? comparison : -comparison;
      }
      return 0;
    });
  }

  // Apply offset & limit
  if (builder.offsetVal !== undefined) {
    docs = docs.slice(builder.offsetVal);
  }
  if (builder.limitVal !== undefined) {
    docs = docs.slice(0, builder.limitVal);
  }

  // Apply selected fields or aggregations
  if (builder.fieldsSelected) {
    const keys = Object.keys(builder.fieldsSelected);
    const firstVal = builder.fieldsSelected[keys[0]];
    
    // Check for counts
    const isCount = keys.length === 1 && (
      (firstVal && typeof firstVal === "object" && "queryChunks" in firstVal) ||
      (firstVal && firstVal.toString && firstVal.toString().includes("count"))
    );
    if (isCount) {
      return [{ [keys[0]]: docs.length }];
    }

    // Check for sum (e.g. fileSize)
    const isSum = keys.length === 1 && (
      firstVal && typeof firstVal === "object" && "queryChunks" in firstVal &&
      JSON.stringify(firstVal.queryChunks).toLowerCase().includes("sum")
    );
    if (isSum) {
      // Find what column is summed
      const sumStr = JSON.stringify(firstVal.queryChunks);
      let sumCol = "fileSize"; // Default fallback
      if (sumStr.includes("fileSize") || sumStr.includes("file_size")) sumCol = "fileSize";
      
      const totalSum = docs.reduce((acc, doc) => acc + Number(doc[sumCol] || 0), 0);
      return [{ [keys[0]]: totalSum }];
    }

    // Standard field mapping
    return docs.map((doc) => {
      const projected: any = {};
      for (const key of keys) {
        const fieldObj = builder.fieldsSelected[key];
        // If it is a Drizzle column, map the column name
        if (fieldObj && typeof fieldObj === "object" && "name" in fieldObj) {
          projected[key] = doc[fieldObj.name];
        } else {
          projected[key] = doc[key];
        }
      }
      return projected;
    });
  }

  return docs;
}

// Fluent Query Builder Class
class QueryBuilder {
  tableName: string;
  action: "select" | "insert" | "update" | "delete";
  conditions: any[] = [];
  limitVal?: number;
  offsetVal?: number;
  orderByVal?: any[];
  valuesToSet?: any;
  fieldsSelected?: any;

  constructor(tableName: string, action: "select" | "insert" | "update" | "delete", fieldsSelected?: any) {
    this.tableName = tableName;
    this.action = action;
    this.fieldsSelected = fieldsSelected;
  }

  select(fields?: any) {
    this.action = "select";
    if (fields) this.fieldsSelected = fields;
    return this;
  }

  from(table: any) {
    this.tableName = getTableName(table);
    return this;
  }

  where(cond: any) {
    if (cond) {
      this.conditions.push(cond);
    }
    return this;
  }

  limit(limit: number) {
    this.limitVal = limit;
    return this;
  }

  offset(offset: number) {
    this.offsetVal = offset;
    return this;
  }

  orderBy(...orders: any[]) {
    this.orderByVal = orders;
    return this;
  }

  set(values: any) {
    this.valuesToSet = values;
    return this;
  }

  values(values: any) {
    this.valuesToSet = values;
    return this;
  }

  returning() {
    return this;
  }

  async execute() {
    return await executeQuery(this);
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// Export Drizzle db proxy
export const db = {
  select: (fields?: any) => {
    return new QueryBuilder("unknown", "select", fields);
  },
  insert: (table: any) => {
    return new QueryBuilder(getTableName(table), "insert");
  },
  update: (table: any) => {
    return new QueryBuilder(getTableName(table), "update");
  },
  delete: (table: any) => {
    return new QueryBuilder(getTableName(table), "delete");
  },
  execute: async (sqlText: any) => {
    return { rows: [], rowCount: 0 };
  },
  transaction: async (cb: (tx: any) => Promise<any>) => {
    return await cb(db);
  },
} as any;


// Export PostgreSQL-compatible pool proxy for raw SQL queries
export const pool = {
  end: async () => {
    // No-op for Firestore/mock DB
  },
  query: async (sqlText: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> => {
    const sql = sqlText.trim().replace(/\s+/g, " ");

    const executeInner = async (): Promise<any[]> => {
      // Health check
      if (sql === "SELECT 1") {
        if (firestore) {
          // Simple firestore reachability check
          await firestore.collection("users").limit(1).get();
        }
        return [{ 1: 1 }];
      }

      // 1. SELECT COUNT(*) FROM table WHERE created_at >= $1
      if (sql.match(/SELECT COUNT\(\*\)\s+as\s+count\s+FROM\s+(\w+)/i)) {
        const tableName = sql.match(/SELECT COUNT\(\*\)\s+as\s+count\s+FROM\s+(\w+)/i)![1];
        let docs = await getAllDocs(tableName);
        if (sql.includes("WHERE")) {
          if (sql.includes("created_at >=") || sql.includes("created_at >= $1")) {
            const since = new Date(params[0]);
            docs = docs.filter((d: any) => new Date(d.created_at || d.createdAt) >= since);
          }
        }
        return [{ count: String(docs.length) }];
      }

      // 2. Usage events counts and averages
      if (sql.includes("usage_events") && sql.includes("COUNT")) {
        let docs = await getAllDocs("usage_events");
        if (sql.includes("created_at >= $1")) {
          const since = new Date(params[0]);
          docs = docs.filter((d: any) => new Date(d.created_at || d.createdAt) >= since);
        }
        if (sql.includes("event_type = 'conversion_completed'") || sql.includes("event_type = $2")) {
          const targetType = params[1] || "conversion_completed";
          docs = docs.filter((d: any) => d.event_type === targetType);
        }
        if (sql.includes("COUNT(DISTINCT user_id)")) {
          const usersSet = new Set(docs.map((d: any) => d.user_id).filter(Boolean));
          return [{ count: String(usersSet.size) }];
        }
        return [{ count: String(docs.length) }];
      }

      // 3. User listings & counting
      if (sql.includes("SELECT COUNT(*) as total FROM users")) {
        let docs = await getAllDocs("users");
        const searchParam = params.find((param: any) => typeof param === "string" && param.includes("%"));
        if (searchParam) {
          const search = searchParam.replace(/%/g, "").toLowerCase();
          docs = docs.filter(
            (d: any) =>
              String(d.email || "").toLowerCase().includes(search) ||
              String(d.first_name || d.firstName || "").toLowerCase().includes(search) ||
              String(d.id || "").toLowerCase().includes(search) ||
              String(d.user_number || d.userNumber || "").includes(search)
          );
        }
        return [{ total: String(docs.length) }];
      }

      // 4. Users list query with complex projection and subqueries
      if (sql.includes("SELECT u.id, u.email, u.first_name")) {
        let docs = await getAllDocs("users");
        // Search filter
        const searchParam = params.find((param: any) => typeof param === "string" && param.includes("%"));
        if (searchParam) {
          const search = searchParam.replace(/%/g, "").toLowerCase();
          docs = docs.filter(
            (d: any) =>
              String(d.email || "").toLowerCase().includes(search) ||
              String(d.firstName || "").toLowerCase().includes(search) ||
              String(d.id || "").toLowerCase().includes(search) ||
              String(d.userNumber || "").includes(search)
          );
        }
        
        // Sort
        docs.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

        // Fetch supplementary info for projection
        const recs = await getAllDocs("recordings");
        
        const mapped = docs.map((u: any) => {
          const userRecs = recs.filter((r) => r.user_id === u.id || r.userId === u.id);
          const lastRec = userRecs.length > 0 ? userRecs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] : null;
          
          return {
            id: u.id,
            email: u.email,
            first_name: u.firstName,
            job_type: u.jobType,
            user_number: u.userNumber,
            created_at: u.createdAt,
            stripe_customer_id: u.stripeCustomerId,
            stripe_subscription_id: u.stripeSubscriptionId,
            email_verified: u.emailVerified,
            role: u.role,
            cached_tier: u.cachedTier,
            cloud_sync_enabled: u.cloudSyncEnabled,
            recording_count: userRecs.length,
            last_recording_at: lastRec ? lastRec.created_at : null,
          };
        });

        // Pagination
        const numericParams = params.filter((param: any) => typeof param === "number");
        const limit = numericParams[numericParams.length - 2] || 25;
        const offset = numericParams[numericParams.length - 1] || 0;
        return mapped.slice(offset, offset + limit);
      }

      // 5. SELECT id FROM users WHERE stripe_subscription_id = $1 OR ...
      if (sql.includes("SELECT id FROM users WHERE stripe_subscription_id =") || sql.includes("stripe_subscription_id = $1")) {
        const subId = params[0];
        const docs = await getAllDocs("users");
        const matched = docs.filter(
          (u: any) =>
            u.stripe_subscription_id === subId ||
            u.cloud_sync_subscription_id === subId ||
            u.pro_access_subscription_id === subId
        );
        return matched.map((m) => ({ id: m.id }));
      }

      // 6. Generic SELECT * FROM table WHERE id = $1
      if (sql.match(/SELECT\s+\*\s+FROM\s+(\w+)\s+WHERE\s+id\s+=\s+\$1/i)) {
        const table = sql.match(/SELECT\s+\*\s+FROM\s+(\w+)\s+WHERE\s+id\s+=\s+\$1/i)![1];
        const id = params[0];
        const docs = await getAllDocs(table);
        const matched = docs.find((d: any) => d.id === id);
        return matched ? [matched] : [];
      }

      // 7. Generic UPDATE table SET column1 = $2 ... WHERE id = $1
      if (sql.startsWith("UPDATE")) {
        const tableName = sql.match(/UPDATE\s+(\w+)/i)![1];
        let id = params[0];
        
        // If UPDATE is like: UPDATE users SET cloud_sync_enabled = 0 ...
        const setPart = sql.split("WHERE")[0].replace(/UPDATE\s+\w+\s+SET\s+/i, "");
        
        if (sql.includes("WHERE id =")) {
          const idIndexStr = sql.split("WHERE")[1].match(/\$(\d+)/);
          if (idIndexStr) {
            id = params[Number(idIndexStr[1]) - 1];
          }
        }

        const keys = setPart.split(",").map((p) => p.split("=")[0].trim());
        const updates: any = {};
        
        keys.forEach((key, index) => {
          const match = setPart.split(",")[index].match(/\$(\d+)/);
          if (match) {
            const paramIndex = Number(match[1]) - 1;
            updates[key] = params[paramIndex];
          }
        });


        if (id) {
          const docs = await getAllDocs(tableName);
          const matched = docs.find((d: any) => d.id === id);
          if (matched) {
            const updated = { ...matched, ...updates };
            await writeDoc(tableName, id, updated);
            return [updated];
          }
        } else {
          // Multi update (e.g. backfillLegacyBillingState)
          const docs = await getAllDocs(tableName);
          for (const doc of docs) {
            // Parse CASE / simple values
            const updatedDoc = { ...doc };
            if (setPart.includes("cached_tier = CASE")) {
              updatedDoc.cached_tier = doc.pro_access_enabled === 1 ? "pro" : (doc.cached_tier || "free");
            }
            await writeDoc(tableName, doc.id, updatedDoc);
          }
        }
        return [];
      }

      // 8. INSERT INTO usage_events (event_type, user_id, metadata) VALUES ($1, $2, $3)
      if (sql.startsWith("INSERT INTO usage_events")) {
        const [eventType, userId, metadataStr] = params;
        const metadata = metadataStr ? JSON.parse(metadataStr) : null;
        const id = `ue-${Math.random().toString(36).substr(2, 9)}`;
        const doc = {
          id,
          event_type: eventType,
          user_id: userId,
          metadata,
          created_at: new Date().toISOString(),
        };
        await writeDoc("usage_events", id, doc);
        return [doc];
      }

      // Default return format to prevent crashes on unhandled sql queries
      console.warn("SQL Query fell back to default response:", sqlText);
      return [];
    };

    const rows = await executeInner();
    return { rows, rowCount: rows.length };
  },
  connect: async () => {
    // Return a dummy client matching the pg pool connection interface
    return {
      query: async (sqlText: string, params: any[] = []) => {
        return await pool.query(sqlText, params);
      },
      release: () => {},
    };
  },
};
