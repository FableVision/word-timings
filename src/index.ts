import './vosk';
import vosk from 'vosk';
import fs from "fs-extra";
import { Readable } from "stream";
import wav from "wav";
import { Command } from 'commander';
import path from 'path';
import JSON5 from 'json5';
import glob from 'fast-glob';
import { filterAsync, HashCache, ProjectConfig, CompactTimings, OutputData } from './utils';

async function main()
{
    const program = new Command();
    program
        .option('-c, --config <path to config file>', 'Path to the project configuration file', 'word-times.json5')
        .parse();

    const cwd = process.cwd();
    const configPath = path.resolve(cwd, program.opts().config);
    if (!await fs.pathExists(configPath))
    {
        console.error(`No project file found at ${configPath}`);
        process.exit(1);
        return;
    }

    let config: ProjectConfig;
    try
    {
        config = JSON5.parse(await fs.readFile(configPath, 'utf8'));
    }
    catch (e)
    {
        console.error(`Error when parsing project config file: ${(e as any).message || e}`);
        process.exit(1);
        return;
    }

    if (!config.model)
    {
        console.error('No model path found in configuration file.');
        process.exit(1);
        return;
    }

    vosk.setLogLevel(-1);
    const model = new vosk.Model(path.resolve(cwd, config.model));
    const cache = new HashCache(config.cache || '.wordtimescache');
    await cache.load();

    for (const output of config.outputs)
    {
        const outPath = path.resolve(cwd, output.file);
        let outFileContent: OutputData;
        if (await fs.pathExists(outPath))
        {
            outFileContent = JSON.parse(await fs.readFile(outPath, 'utf8'));
        }
        else
        {
            outFileContent = {};
        }

        const changed = await filterAsync(
            (await Promise.all(output.globs.map(g => glob(g, {cwd})))).flat(),
            (file) => !outFileContent[path.basename(file, '.wav')] || cache.isDifferent(file, cwd)
        );

        for (const file of changed)
        {
            try
            {
                outFileContent[path.basename(file, '.wav')] = await getTimings(path.resolve(cwd, file), model);
            }
            catch (e)
            {
                console.error((e as any).message || e);
            }
        }

        await fs.writeFile(outPath, JSON.stringify(outFileContent, null, config.pretty ? '\t' : undefined));
    }

    model.free();

    cache.purgeUnseen();
    await cache.save();
}

async function getTimings(file: string, model: vosk.Model)
{
    return new Promise<CompactTimings>(async (resolve, reject) => {
        const wfReader = new wav.Reader();
        const wfReadable = new Readable().wrap(wfReader);

        wfReader.on('format', async ({ audioFormat, sampleRate, channels }) =>
        {
            const rec = new vosk.Recognizer({ model: model, sampleRate: sampleRate });
            // rec.setMaxAlternatives(3);
            rec.setWords(true);
            if (audioFormat != 1 || channels != 1)
            {
                reject(`Audio file ${file} must be WAV format mono PCM.`);
                rec.free();
                return;
            }
            // feed in individual chunks of the wav file
            for await (const data of wfReadable)
            {
                await rec.acceptWaveformAsync(data);
            }
            const result = rec.finalResult();
            rec.free();

            const out: CompactTimings = [];
            let lastEnd = 0;
            for (const word of result.result)
            {
                // if word starts when the last one ended, just put in the ending time
                if (Math.abs(word.start - lastEnd) < 0.0001)
                {
                    out.push(word.end);
                }
                // otherwise add start & end times
                else
                {
                    out.push([word.start, word.end]);
                }
                lastEnd = word.end;
            }

            resolve(out);
        });

        fs.createReadStream(file, { 'highWaterMark': 4096 }).pipe(wfReader);
    });
}

main();