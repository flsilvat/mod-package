// Firestore collection names — the single source of truth.
// Each entity from the data model maps to one collection. Keeping the names
// here (rather than typed as strings all over the code) means a rename only
// ever happens in one place.
//
//   Data model entity        Firestore collection
//   -----------------------  --------------------
export const COLLECTIONS = {
  AIRCRAFT: 'aircraft', //         AIRCRAFT
  SERVICE_BULLETIN: 'serviceBulletins', // SERVICE_BULLETIN
  SB_CONFIG: 'sbConfigs', //       SB_CONFIG  (groups aircraft for a Service Bulletin)
  DRAWING: 'drawings', //          DRAWING
  MATERIAL: 'materials', //        MATERIAL   (a part; may be a kit of other materials)
  TECHNICAL_ORDER: 'technicalOrders', // TECHNICAL_ORDER
  TO_PART: 'toParts', //           TO_PART    (one part of a TO, covers one SB_CONFIG)
  HTL: 'htls', //                  HTL        (hierarchical task list)
  GTL: 'gtls', //                  GTL        (general task list)
  OPERATION: 'operations', //      OPERATION  (a single SAP step)
};
