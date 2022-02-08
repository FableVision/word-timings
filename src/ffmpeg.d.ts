declare module "ffmpeg-cli"
{
    const ffmpeg: {
        path: string;
        run: (command: string) => Promise<string>;
        runSync: (command: string) => string;
    };
    export = ffmpeg;
}