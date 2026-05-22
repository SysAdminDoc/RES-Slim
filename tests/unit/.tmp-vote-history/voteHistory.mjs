/*       */
// Pure helpers for the voteHistory module. Models vote-event records and the
// IndexedDB schema, plus utility functions for filtering and exporting.
// Dependency-free for unit testing — the actual IDB plumbing lives in the
// module file.

                                                     

                           
                                                                       
                                                
                   
                          
                   
                
                   
                                                           
                     
                                  
   

export const SCHEMA_VERSION = 1;
export const DB_NAME = 'rsm-voteHistory';
export const STORE_NAME = 'votes';

const SNIPPET_LIMIT = 240;

function str(v       )         { return typeof v === 'string' ? v : ''; }
function num(v       )         { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function makeId(fullname        , timestamp        )         {
	return `${fullname}@${Math.floor(timestamp)}`;
}

export function classifyDirection(raw       )                 {
	if (raw === 1 || raw === '1' || raw === 'up' || raw === true) return 'up';
	if (raw === -1 || raw === '-1' || raw === 'down') return 'down';
	if (raw === 0 || raw === '0' || raw === 'unvote' || raw === null) return 'unvote';
	return null;
}

export function buildRecord(input    
                  
                          
                  
               
                  
             
                    
              
  )              {
	const fullname = str(input.fullname);
	if (!fullname) return null;
	const kind = fullname.startsWith('t3_') ? 't3' : fullname.startsWith('t1_') ? 't1' : null;
	if (!kind) return null;
	const now = typeof input.now === 'number' ? input.now : Date.now();
	const snippet = str(input.body).replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LIMIT);
	return {
		id: makeId(fullname, now),
		fullname,
		kind,
		direction: input.direction,
		subreddit: str(input.subreddit),
		author: str(input.author),
		permalink: str(input.permalink),
		snippet,
		scoreAtTime: num(input.scoreAtTime),
		timestamp: now,
	};
}

export function filterRecords(records                            , opts    
                     
                  
                            
                 
                 
  )               {
	return records.filter(r => {
		if (opts.subreddit && r.subreddit.toLowerCase() !== opts.subreddit.toLowerCase()) return false;
		if (opts.author && r.author.toLowerCase() !== opts.author.toLowerCase()) return false;
		if (opts.direction && r.direction !== opts.direction) return false;
		if (typeof opts.since === 'number' && r.timestamp < opts.since) return false;
		if (typeof opts.until === 'number' && r.timestamp > opts.until) return false;
		return true;
	});
}

export function toCsv(records                            )         {
	const header = ['timestamp', 'direction', 'fullname', 'kind', 'subreddit', 'author', 'permalink', 'scoreAtTime', 'snippet'];
	const escape = (val       ) => {
		const s = String(val == null ? '' : val);
		if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
		return s;
	};
	const lines = [header.join(',')];
	for (const r of records) {
		lines.push([
			new Date(r.timestamp).toISOString(),
			r.direction,
			r.fullname,
			r.kind,
			r.subreddit,
			r.author,
			r.permalink,
			String(r.scoreAtTime),
			r.snippet,
		].map(escape).join(','));
	}
	return lines.join('\n');
}
