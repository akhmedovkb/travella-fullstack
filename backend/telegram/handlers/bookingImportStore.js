// Private import checkpoint, separate from the ordinary provider wizard.
function createBookingImportStore(pool){
 let ready;const initialize=()=>ready||(ready=pool.query(`CREATE TABLE IF NOT EXISTS telegram_booking_import_drafts(actor_id BIGINT PRIMARY KEY,payload JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`).catch(e=>{ready=null;throw e;}));
 return {async load(actor){await initialize();const r=await pool.query('SELECT payload FROM telegram_booking_import_drafts WHERE actor_id=$1 AND expires_at>NOW()',[actor]);return r.rows[0]?.payload;},async save(actor,payload){await initialize();if(!payload){await pool.query('DELETE FROM telegram_booking_import_drafts WHERE actor_id=$1',[actor]);return;}await pool.query(`INSERT INTO telegram_booking_import_drafts(actor_id,payload,expires_at) VALUES($1,$2::jsonb,NOW()+INTERVAL '30 days') ON CONFLICT(actor_id) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at,updated_at=NOW()`,[actor,JSON.stringify(payload)]);}};
}
module.exports={createBookingImportStore};
