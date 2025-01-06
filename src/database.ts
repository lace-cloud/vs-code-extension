
import * as fs from 'fs';
import * as path from 'path';
import sqlite3 from 'sqlite3';
import { Node, Edge } from 'react-flow-renderer';

// Define paths for the database
const dbDir = path.join(__dirname, '../data');
const dbPath = path.join(dbDir, 'lace.db');

// Ensure the database directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize the database
export const initializeDatabase = (): void => {
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error opening database:', err.message);
    } else {
      console.log('Connected to SQLite database at', dbPath);
      db.run(
        `CREATE TABLE IF NOT EXISTS components (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          canvas_state TEXT
        )`,
        (err) => {
          if (err) {
            console.error('Error creating table:', err.message);
          }
        }
      );
    }
  });
};

// Type definitions
type Component = {
  id: number;
  name: string;
  canvas_state?: string;
};

type CanvasState = {
  nodes: Node[];
  edges: Edge[];
};

// Add a new component
export const addComponent = (name: string): Promise<void> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO components (name) VALUES (?)', [name], (err) => {
      db.close();
      if (err) {
        console.error('Error adding component:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

// Retrieve all components
export const getComponents = (): Promise<Component[]> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.all('SELECT id, name, canvas_state FROM components', [], (err, rows) => {
      db.close();
      if (err) {
        console.error('Error retrieving components:', err.message);
        reject(err);
      } else {
        resolve(rows as Component[]); // Explicitly cast `rows` to `Component[]`
      }
    });
  });
};


// Get a component ID by name
export const getComponentIdByName = (name: string): Promise<number | null> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.get<{ id: number }>('SELECT id FROM components WHERE name = ?', [name], (err, row) => {
      db.close();
      if (err) {
        console.error('Error retrieving component ID:', err.message);
        reject(err);
      } else {
        resolve(row ? row.id : null); // Safely access `id` from the row
      }
    });
  });
};


// Save the canvas state for a specific component
// export const saveCanvasState = (componentId: number, state: CanvasState): Promise<void> => {
//   const db = new sqlite3.Database(dbPath);
//   return new Promise((resolve, reject) => {
//     const serializedState = JSON.stringify(state);
//     console.log('------serializedState--',serializedState);
//     db.run(
//       'UPDATE components SET canvas_state = ? WHERE id = ?',
//       [serializedState, componentId],
//       (err) => {
//         db.close();
//         if (err) {
//           console.error('Failed to save canvas state:', err.message);
//           reject(err);
//         } else {
//           console.log(`Canvas state saved for component ID ${componentId}.`);
//           resolve();
//         }
//       }
//     );
//   });
// };

// // Load the canvas state for a specific component
// export const loadCanvasState = (componentId: number): Promise<CanvasState | null> => {
//   const db = new sqlite3.Database(dbPath);
//   return new Promise((resolve, reject) => {
//     db.get('SELECT canvas_state FROM components WHERE id = ?', [componentId], (err, row) => {
//       db.close();
//       if (err) {
//         console.error('Failed to load canvas state:', err.message);
//         reject(err);
//       } else {
//         console.log('Loaded canvas state from database:', row);
//         const canvasState = row ? (JSON.parse((row as Component).canvas_state || '{}') as CanvasState) : null;
//         resolve(canvasState);
//       }
//     });
//   });
// };

export const saveCanvasState = (componentId: number, state: CanvasState): Promise<void> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    const serializedState = JSON.stringify(state);
    db.run(
      'UPDATE components SET canvas_state = ? WHERE id = ?',
      [serializedState, componentId],
      (err) => {
        db.close();
        if (err) {
          console.error('Failed to save canvas state:', err.message);
          reject(err);
        } else {
          console.log(`Canvas state saved for component ID ${componentId}.`);
          resolve();
        }
      }
    );
  });
};

export const loadCanvasState = (componentId: number): Promise<CanvasState | null> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.get<{ canvas_state: string }>('SELECT canvas_state FROM components WHERE id = ?', [componentId], (err, row) => {
      db.close();
      if (err) {
        console.error('Failed to load canvas state:', err.message);
        reject(err);
      } else {
        const canvasState = row?.canvas_state
          ? (JSON.parse(row.canvas_state) as CanvasState)
          : { nodes: [], edges: [] }; // Default to empty state if no state exists
        resolve(canvasState);
      }
    });
  });
};





// Remove a component by ID
export const removeComponent = (componentId: number): Promise<void> => {
  const db = new sqlite3.Database(dbPath);
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM components WHERE id = ?', [componentId], (err) => {
      db.close();
      if (err) {
        console.error('Error removing component:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};




