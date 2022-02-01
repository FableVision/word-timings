import fs from 'fs-extra';
import path from 'path';
import hasha from 'hasha';

export interface ProjectConfig
{
    model: string;
    cache?: string;
    pretty?: boolean;
    outputs: {file: string, globs: string[]}[];
}

export type CompactTimings = (number|[number, number])[];

export interface OutputData
{
    [fileId: string]: CompactTimings;
}

export async function filterAsync<T>(input: T[], test: (item:T) => Promise<boolean>): Promise<T[]>
{
    const out: T[] = [];

    for (const item of input)
    {
        if (await test(item))
        {
            out.push(item);
        }
    }

    return out;
}

export class HashCache
{
    private hashes: Map<string, string>;
    private unseen: Set<string>;
    private cachePath: string;

    constructor(cachePath: string)
    {
        this.hashes = new Map();
        this.unseen = new Set();
        this.cachePath = path.resolve(process.cwd(), cachePath);
    }

    public async isDifferent(filePath: string, rootDir: string): Promise<boolean>
    {
        const absPath = path.resolve(rootDir, filePath);
        const hash = await hasha.fromFile(absPath, {algorithm: 'md5'});
        // if not present in cache, return true (add to hashes)
        // if present, remove from unseen, compare hash with hasha, and update hashes if changed
        let changed = true;
        if (this.hashes.get(filePath) == hash)
        {
            changed = false;
        }
        else
        {
            this.hashes.set(filePath, hash);
        }
        this.unseen.delete(filePath);
        return changed;
    }

    public async load()
    {
        if (!(await fs.pathExists(this.cachePath)))
        {
            return;
        }
        const file = await fs.readFile(this.cachePath, 'utf8');
        const lines = file.split(/\r?\n/);
        for (let line of lines)
        {
            if (!line) continue;
            let fileId: string;
            let hash: string;
            if (line[0] == '"')
            {
                fileId = line.substring(1, line.indexOf('"', 1));
                hash = line.substring(line.indexOf('"', 1) + 2);
            }
            else
            {
                fileId = line.substring(0, line.indexOf(' ', 1));
                hash = line.substring(line.indexOf(' ') + 1);
            }
            this.hashes.set(fileId, hash);
            this.unseen.add(fileId);
        }
    }

    public async save()
    {
        let text = '';
        for (const [fileId, hash] of this.hashes.entries())
        {
            text += `${fileId.includes(' ') ? `"${fileId}"` : fileId} ${hash}\n`;
        }
        await fs.writeFile(this.cachePath, text);
    }

    public purgeUnseen(): string[]
    {
        const missing = Array.from(this.unseen.values());
        for (const id of missing)
        {
            this.hashes.delete(id);
        }
        this.unseen.clear();

        return missing;
    }
}