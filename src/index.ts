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

export { ProjectConfig, CompactTimings, OutputData } from './utils';

export default class WordTimingGenerator
{
    /**
     * If data of each parsed line should be output.
     */
    public logLineOutput = true;

    public static cli()
    {
        const program = new Command();
        program
            .option('-c, --config <path to config file>', 'Path to the project configuration file', 'word-times.json5')
            .parse();

        const cwd = process.cwd();
        const configPath = path.resolve(cwd, program.opts().config);

        const gen = new WordTimingGenerator();
        gen.readConfigAndRun(configPath, cwd).catch(err => {
            console.error(err);
            process.exit(1);
        });
    }

    public async readConfigAndRun(configPath: string, cwd = process.cwd())
    {
        if (!await fs.pathExists(configPath))
        {
            throw `No project file found at ${configPath}`;
        }

        let config: ProjectConfig;
        try
        {
            config = JSON5.parse(await fs.readFile(configPath, 'utf8'));
        }
        catch (e)
        {
            throw `Error when parsing project config file: ${(e as any).message || e}`;
        }

        if (!config.model)
        {
            throw 'No model path found in configuration file.';
        }
        return this.runAndWriteOutput(config, cwd);
    }

    public async runAndWriteOutput(config: ProjectConfig, cwd = process.cwd())
    {
        return this.run(
            config,
            async (outPath) =>
            {
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
                return outFileContent;
            },
            async (outFileContent, outPath, pretty) =>
            {
                let outputText: string;
                if (pretty)
                {
                    let outputLines = [];
                    for (const filename in outFileContent)
                    {
                        outputLines.push(`"${filename}": [${outFileContent[filename].map(t => JSON.stringify(t)).join(', ')}]`);
                    }
                    outputText = `{\n\t${outputLines.join(',\n\t')}\n}`;
                }
                else
                {
                    outputText = JSON.stringify(outFileContent);
                }
                await fs.writeFile(outPath, outputText);
            },
            cwd
        );
    }

    public async run(
        config: ProjectConfig,
        readExistingOutput: (outPath:string) => Promise<OutputData>,
        writeOutput: (data: OutputData, outPath: string, pretty: boolean) => Promise<void>,
        cwd = process.cwd(),
    ): Promise<void>
    {
        vosk.setLogLevel(-1);
        const model = new vosk.Model(path.resolve(cwd, config.model));
        const cache = new HashCache(config.cache || '.wordtimescache');
        await cache.load();

        for (const output of config.outputs)
        {
            const outPath = path.resolve(cwd, output.file);
            let outFileContent: OutputData = await readExistingOutput(outPath);

            const changed = await filterAsync(
                (await Promise.all(output.globs.map(g => glob(g, { cwd })))).flat(),
                async (file) => (await cache.isDifferent(file, cwd)) || !outFileContent[path.basename(file, '.wav')]
            );

            for (const file of changed)
            {
                try
                {
                    outFileContent[path.basename(file, '.wav')] = await this.getTimings(path.resolve(cwd, file), model);
                }
                catch (e)
                {
                    throw (e as any).message || e;
                }
            }

            await writeOutput(outFileContent, outPath, !!config.pretty);
        }

        model.free();

        cache.purgeUnseen();
        await cache.save();
    }

    private async getTimings(file: string, model: vosk.Model)
    {
        return new Promise<CompactTimings>(async (resolve, reject) =>
        {
            const sampleRate = 16000;
            const rec = new vosk.Recognizer({model: model, sampleRate: sampleRate});
            rec.setWords(true);

            const ffmpeg_run = spawn(ffmpeg.path, ['-loglevel', 'quiet', '-i', file,
                '-ar', String(sampleRate), '-ac', '1',
                '-f', 's16le', '-bufsize', String(4000), '-']);

            ffmpeg_run.on('error', (error) =>
            {
                console.log(error);
                reject(`Failure on ${file}: ` + error.message);
            });

            ffmpeg_run.stdout.on('data', (stdout) =>
            {
                rec.acceptWaveform(stdout);
            });

            ffmpeg_run.stdout.on('end', () =>
            {
                const result = rec.finalResult();
                rec.free();

                const out: CompactTimings = [];
                let lastEnd = 0;
                if (!result.result)
                {
                    reject(`Bad result for ${path.relative(process.cwd(), file)}: JSON.stringify(result)`);
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

                if (this.logLineOutput)
                {
                    console.log(`${path.relative(process.cwd(), file)}: ${result.result.map(w => w.word).join(' ')}`);
                }
                resolve(out);
            });
        });
    }
}