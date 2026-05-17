# Data model

This is the agreed shape of the data. Each entity becomes one Firestore
**collection**; every document in it has an auto-generated `id`. Relationships
are stored as **arrays of IDs** on the document (Firestore's version of a
foreign key) — there is no JOIN, so our code follows the IDs.

Collection names live in one place: `src/lib/collections.js`.

| Entity (data model) | Firestore collection |
| ------------------- | -------------------- |
| AIRCRAFT            | `aircraft`           |
| SERVICE_BULLETIN    | `serviceBulletins`   |
| SB_CONFIG           | `sbConfigs`          |
| DRAWING             | `drawings`           |
| MATERIAL            | `materials`          |
| TECHNICAL_ORDER     | `technicalOrders`    |
| TO_PART             | `toParts`            |
| HTL                 | `htls`               |
| GTL                 | `gtls`               |
| OPERATION           | `operations`         |

## Conventions

- **IDs** — every document has an `id`. References use that id.
- **Many-to-many** — stored as an array of ids on one side (e.g. a service
  bulletin holds `drawingIds`). The reverse lookup uses an `array-contains`
  query.
- **Quantities and order** live on the *link*, not the entity. A link that
  needs a quantity is an object: `{ materialId, qty }`. A link that needs a
  sequence carries a `sort` number.
- **Recursion** (kits inside kits, drawings referencing drawings, HTLs inside
  HTLs) is just an entity holding ids of its own type. A small recursive
  function walks the tree; a visited-set guards against accidental loops.

## Collections

### `aircraft` — AIRCRAFT
`registration` · `fleetType` · `createdAt`

### `serviceBulletins` — SERVICE_BULLETIN
`sbRef` · `title` · `drawingIds[]` · `materials[{materialId, qty}]` ·
`manualRefs[{type, ref}]` (AMM, SRM, IPC…)

### `sbConfigs` — SB_CONFIG
Belongs to one service bulletin. Groups the aircraft a config applies to.
`sbId` · `name` · `aircraftIds[]`

### `drawings` — DRAWING
`docNumber` · `rev` · `title` · `refDrawingIds[]` (recursive) ·
`materials[{materialId, qty}]` · `aircraftIds[]`

### `materials` — MATERIAL
A part. If `isKit` is true, `components` lists what it contains — and any of
those may themselves be kits (seen up to 4 levels deep).
`partNumber` · `description` · `isKit` · `components[{materialId, qty}]`

### `technicalOrders` — TECHNICAL_ORDER
The deliverable. Built from one service bulletin, split into TO parts.
`toNumber` · `sbId`

### `toParts` — TO_PART
One "Part" of a TO. Covers exactly one SB config and uses exactly one HTL.
`technicalOrderId` · `partLabel` · `sbConfigId` · `htlId`

### `htls` — HTL
Hierarchical task list. Groups GTLs and other HTLs into a tree.
`htlRef` · `children[{kind: 'htl'|'gtl', id, sort}]` · `aircraftIds[]`

### `gtls` — GTL
General task list. A reusable group of operations.
`gtlRef` · `aircraftIds[]`

### `operations` — OPERATION
A single SAP step. Belongs to one GTL.
`gtlId` · `opNumber` · `text` · `drawingIds[]` ·
`materials[{materialId, qty}]`

## Relationships at a glance

- SERVICE_BULLETIN has many SB_CONFIG
- SB_CONFIG groups many AIRCRAFT (many-to-many)
- SERVICE_BULLETIN references many DRAWING and many MATERIAL
- DRAWING references many DRAWING (recursive), MATERIAL, AIRCRAFT
- MATERIAL contains many MATERIAL (recursive — kits)
- TECHNICAL_ORDER built from one SERVICE_BULLETIN, split into many TO_PART
- TO_PART covers one SB_CONFIG, uses one HTL
- HTL contains many HTL (recursive) and many GTL
- GTL contains many OPERATION
- OPERATION references many DRAWING and many MATERIAL
- GTL and HTL each carry an optional applicable-aircraft list
