import { Link } from 'react-router-dom';

// The entities from the data model, with current build status.
const ENTITIES = [
  { name: 'Aircraft', status: 'ready', note: 'Registrations and fleet types.' },
  { name: 'Materials', status: 'planned', note: 'Parts and kits (kits may nest).' },
  { name: 'Drawings', status: 'planned', note: 'Documents that reference each other.' },
  { name: 'Service Bulletins', status: 'planned', note: 'Work instructions and configs.' },
  { name: 'SB Configs', status: 'planned', note: 'Aircraft groupings per bulletin.' },
  { name: 'Technical Orders', status: 'planned', note: 'The deliverable, built per config.' },
  { name: 'HTL / GTL', status: 'planned', note: 'The reusable task-list tree.' },
  { name: 'Operations', status: 'planned', note: 'Individual SAP step text.' },
];

export default function HomePage() {
  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Overview</p>
        <h1>Modification package workspace</h1>
        <p className="lede">
          One place to capture a modification package — its bulletin, drawings,
          materials and tasks — see how it all connects, and produce the data
          needed to set up the order in SAP.
        </p>
      </div>

      <section className="panel">
        <h2 className="panel-title">Entities</h2>
        <p className="panel-sub">
          Each entity becomes a section of this app. The foundation is in place;
          Aircraft is the first one ready to use.
        </p>
        <ul className="entity-grid">
          {ENTITIES.map((e) => (
            <li key={e.name} className={'entity-card status-' + e.status}>
              <div className="entity-card-top">
                <span className="entity-name">{e.name}</span>
                <span className={'tag tag-' + e.status}>{e.status}</span>
              </div>
              <p className="entity-note">{e.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel callout">
        <div>
          <h2 className="panel-title">Start with Aircraft</h2>
          <p className="panel-sub">
            The simplest entity, and the one everything else references. Add a
            few and they save straight to the database.
          </p>
        </div>
        <Link to="/aircraft" className="btn btn-primary">
          Open Aircraft →
        </Link>
      </section>
    </div>
  );
}
