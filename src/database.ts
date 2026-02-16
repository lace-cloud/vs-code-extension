import * as fs from 'fs';
import * as path from 'path';
import sqlite3 from 'sqlite3';
import { Node, Edge } from 'react-flow-renderer';

const dbDir = path.join(__dirname, '../data');
const dbPath = path.join(dbDir, 'lace.db');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

type Component = {
  id: number;
  name: string;
  canvas_state?: string;
  bundle_state?: string;
};

type CanvasState = {
  nodes: Node[];
  edges: Edge[];
};

function run(db: sqlite3.Database, sql: string, params: any[] = []) {
  return new Promise<void>((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function get<T>(db: sqlite3.Database, sql: string, params: any[] = []) {
  return new Promise<T | undefined>((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T)));
  });
}

function all<T>(db: sqlite3.Database, sql: string, params: any[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    db.all(sql, params, (err, rows) =>
      err ? reject(err) : resolve(rows as T[])
    );
  });
}

async function ensureBundleStateColumn(db: sqlite3.Database) {
  const cols = await all<{ name: string }>(db, `PRAGMA table_info(components)`);
  const has = cols.some((c) => c.name === 'bundle_state');
  if (!has) {
    await run(db, `ALTER TABLE components ADD COLUMN bundle_state TEXT`);
  }
}

export const initializeDatabase = async (): Promise<void> => {
  const db = new sqlite3.Database(dbPath);

  try {
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        canvas_state TEXT,
        bundle_state TEXT
      )`
    );

    // migration safety
    await ensureBundleStateColumn(db);

    console.log('Connected to SQLite database at', dbPath);
  } finally {
    db.close();
  }
};

export const addComponent = (name: string): Promise<void> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO components (name) VALUES (?)', [name], (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
};

export const getComponents = async (): Promise<Component[]> => {
  const db = new sqlite3.Database(dbPath);
  try {
    return await all<Component>(db, 'SELECT id, name, canvas_state, bundle_state FROM components');
  } finally {
    db.close();
  }
};

export const getComponentIdByName = (name: string): Promise<number | null> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.get<{ id: number }>(
      'SELECT id FROM components WHERE name = ?',
      [name],
      (err, row) => {
        db.close();
        if (err) reject(err);
        else resolve(row ? row.id : null);
      }
    );
  });
};

export const saveCanvasState = (componentId: number, state: CanvasState): Promise<void> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    const serializedState = JSON.stringify(state);
    db.run(
      'UPDATE components SET canvas_state = ? WHERE id = ?',
      [serializedState, componentId],
      (err) => {
        db.close();
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

export const loadCanvasState = (componentId: number): Promise<CanvasState> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.get<{ canvas_state: string }>(
      'SELECT canvas_state FROM components WHERE id = ?',
      [componentId],
      (err, row) => {
        db.close();
        if (err) reject(err);
        else {
          const canvasState = row?.canvas_state
            ? (JSON.parse(row.canvas_state) as CanvasState)
            : { nodes: [], edges: [] };
          resolve(canvasState);
        }
      }
    );
  });
};

// ✅ NEW: save bundle JSON into bundle_state
export const saveBundleState = (componentId: number, bundle: any): Promise<void> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    const serialized = JSON.stringify(bundle);
    db.run(
      'UPDATE components SET bundle_state = ? WHERE id = ?',
      [serialized, componentId],
      (err) => {
        db.close();
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

// ✅ NEW: load bundle JSON from bundle_state
export const loadBundleState = (componentId: number): Promise<any | null> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.get<{ bundle_state: string }>(
      'SELECT bundle_state FROM components WHERE id = ?',
      [componentId],
      (err, row) => {
        db.close();
        if (err) reject(err);
        else resolve(row?.bundle_state ? JSON.parse(row.bundle_state) : null);
      }
    );
  });
};

export const removeComponent = (componentId: number): Promise<void> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM components WHERE id = ?', [componentId], (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
};
