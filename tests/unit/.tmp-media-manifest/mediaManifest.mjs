/*       */
// Pure helpers for the mediaArchiveManifest module. Models the manifest
// record shape and exposes pure formatting + filter helpers. The actual
// IDB plumbing lives in the module file.

                                   
                                           
             
                  
                       
                      
                   
                                                                                                         
              
               
                   
   

export const SCHEMA_VERSION = 1;
export const DB_NAME = 'rsm-mediaManifest';
export const STORE_NAME = 'entries';

function str(v       )         { return typeof v === 'string' ? v : ''; }
function num(v       )         { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function makeId(url        , timestamp        )         {
	// Hash-free deterministic id — collisions are vanishingly unlikely for the
	// browser's perspective since `timestamp` is millisecond-precise.
	return `${Math.floor(timestamp)}::${url.slice(0, 200)}`;
}

export function buildEntry(input    
            
                 
                      
                     
                  
               
              
               
              
  )                      {
	const url = str(input.url);
	if (!url) return null;
	const now = typeof input.now === 'number' ? input.now : Date.now();
	const source = str(input.source) || 'manual';
	return {
		id: makeId(url, now),
		url,
		filename: str(input.filename),
		postPermalink: str(input.postPermalink),
		postFullname: str(input.postFullname),
		subreddit: str(input.subreddit),
		source,
		mime: str(input.mime),
		bytes: num(input.bytes),
		timestamp: now,
	};
}

export function filterEntries(entries                                    , opts    
                  
                     
                 
                 
  )                       {
	return entries.filter(e => {
		if (opts.source && e.source !== opts.source) return false;
		if (opts.subreddit && e.subreddit.toLowerCase() !== opts.subreddit.toLowerCase()) return false;
		if (typeof opts.since === 'number' && e.timestamp < opts.since) return false;
		if (typeof opts.until === 'number' && e.timestamp > opts.until) return false;
		return true;
	});
}

export function buildExport(entries                                    )                      {
	return {
		schemaVersion: SCHEMA_VERSION,
		exportedAt: Date.now(),
		count: entries.length,
		entries: entries.slice(),
	};
}

export function isDownloadAnchor(el       )          {
	if (!el || typeof (el     ).getAttribute !== 'function') return false;
	const tag = (el     ).tagName;
	if (tag !== 'A') return false;
	const href = (el     ).getAttribute('href') || '';
	if (!href || href === '#' || href.startsWith('javascript:')) return false;
	const hasDownload = (el     ).hasAttribute('download');
	if (hasDownload) return true;
	// Anchors with class names known to trigger downloads.
	const cls         = (el     ).className || '';
	return /(?:^|\s)(?:RES-download|rsm-cobalt-btn|rsm-localCompanion-btn|rsm-galleryZip-btn)(?:\s|$)/.test(String(cls));
}
