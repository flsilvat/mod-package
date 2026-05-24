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
| —                   | `userRoles`          |

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
`sbRef` · `rev` · `title` · `drawingIds[]` ·
`materials[{materialId, qty}]`

`rev` is a free-text revision string (e.g. "A", "Rev 2", "Original Issue").
Optional — empty for SBs that haven't been formally issued yet. Changing
the rev updates the display everywhere the SB is referenced; nothing is
snapshot-versioned on linked TOs, drawings, or parts.

### `sbConfigs` — SB_CONFIG
Belongs to one service bulletin. Groups the aircraft a config applies to.
`sbId` · `name` · `aircraftIds[]`

### `drawings` — DRAWING
`docNumber` · `rev` · `title` · `refDrawingIds[]` (recursive) ·
`materials[{materialId, qty}]` · `sbConfigIds[]`

`sbConfigIds[]` lists the SB configurations the drawing applies to. An empty
list means it applies to *all* configurations of its bulletin — only the
exceptions are tagged. This drives each configuration's materials bucket.

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
`materials[{materialId, qty, fromKitId?}]`

`fromKitId` is the id of the kit this material was cracked from. Absent (or
null) means the material is loose, or — if the material is itself a kit —
that it was assigned as a whole. Set, it must point to a kit that has this
material as a direct component.

### `interchangeGroups` — INTERCHANGE_GROUP
An equivalence class of materials that can be used in place of each other.
`materialIds[]` · `note`

Symmetric and transitive within the group — every member is interchangeable
with every other member. `note` is a short free-text justification for the
link (e.g. "vendor alternate per EO 12345"). A material belongs to at most
one group. A group with fewer than two members is meaningless and is
deleted automatically. The bucket reconciliation treats an op-material entry
as satisfying a bucket line whose materialId is anywhere in the same group.

### `userRoles` — access control
Not a data-model entity. One document per person; the document **id is their
email** (lowercase). Field: `role` — either `admin` or `viewer`.
An admin can read and change everything; a viewer can only read.

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
