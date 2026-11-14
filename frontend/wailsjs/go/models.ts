export namespace main {
	
	export class ImportResult {
	    title: string;
	    added: number;
	    skipped: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.added = source["added"];
	        this.skipped = source["skipped"];
	    }
	}
	export class Recording {
	    id: string;
	    sentenceId: string;
	    text: string;
	    translation: string;
	    durationMs: number;
	    createdAt: string;
	    filename: string;
	
	    static createFrom(source: any = {}) {
	        return new Recording(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sentenceId = source["sentenceId"];
	        this.text = source["text"];
	        this.translation = source["translation"];
	        this.durationMs = source["durationMs"];
	        this.createdAt = source["createdAt"];
	        this.filename = source["filename"];
	    }
	}
	export class Sentence {
	    id: string;
	    text: string;
	    translation: string;
	    category: string;
	    level: string;
	    imported: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Sentence(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.text = source["text"];
	        this.translation = source["translation"];
	        this.category = source["category"];
	        this.level = source["level"];
	        this.imported = source["imported"];
	    }
	}

}

