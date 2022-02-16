/// <ref="./vosk" />
/// <ref="./ffmpeg" />
import vosk from 'vosk';
import fs from "fs-extra";
import ffmpeg from 'ffmpeg-cli';
import { Command } from 'commander';
import path from 'path';
import JSON5 from 'json5';
import glob from 'fast-glob';
import { filterAsync, HashCache, ProjectConfig, CompactTimings, OutputData } from './utils';
import { spawn } from 'child_process';

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
            try
            {
                outFileContent = JSON.parse(await fs.readFile(outPath, 'utf8'));
            }
            catch (_e)
            {
                outFileContent = {};
            }
        }
        else
        {
            outFileContent = {};
        }

        const changed = await filterAsync(
            (await Promise.all(output.globs.map(g => glob(g, {cwd})))).flat(),
            async (file) => (await cache.isDifferent(file, cwd)) || !outFileContent[path.basename(file, '.wav')]
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
        const sampleRate = 16000;
        const rec = new vosk.Recognizer({ model: model, sampleRate: sampleRate });
        rec.setWords(true);

        const ffmpeg_run = spawn(ffmpeg.path, ['-loglevel', 'quiet', '-i', file,
            '-ar', String(sampleRate), '-ac', '1',
            '-f', 's16le', '-bufsize', String(4000), '-']);

        ffmpeg_run.on('error', (error) => {
            console.log(error);
            reject(`Failure on ${file}: ` + error.message);
        });

        ffmpeg_run.stdout.on('data', (stdout) =>
        {
            rec.acceptWaveform(stdout);
        });

        ffmpeg_run.stdout.on('end', () => {
            const result = rec.finalResult();
            rec.free();

            const out: CompactTimings = [];
            let lastEnd = 0;
            if (!result.result)
            {
                reject(`Bad result for ${file}: JSON.stringify(result)`);
                return;
            }
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

            console.log(`${file}: ${result.result.map(w => w.word).join(' ')}`);
            resolve(out);
        });
    });
}

main();