declare module 'vosk'
{
    import { Readable } from "stream";

    export function setLogLevel(level: number): void;

    export class Model
    {
        constructor(path: string);
        free(): void;
    }

    export interface WordResult
    {
        /** @property {number} conf The confidence rate in the detection. 0 For unlikely, and 1 for totally accurate. */
        conf: number;
        /** @property {number} start The start of the timeframe when the word is pronounced in seconds */
        start: number;
        /** @property {number} end The end of the timeframe when the word is pronounced in seconds */
        end: number;
        /** @property {string} word The word detected */
        word: string;
    }

    export interface RecognitionResults
    {
        /** @property {WordResult[]} result Details about the words that have been detected */
        result: WordResult[];
        /** @property {string} text The complete sentence that have been detected */
        text: string;
    }

    export interface PartialResults
    {
        /** The partial sentence that have been detected until now */
        partial: string;
    }

    export class Recognizer
    {
        constructor(opts: {model: Model, sampleRate: number, grammar?: string[]});

        public setMaxAlternatives(count: number): void;
        /** Configures recognizer to output words with times */
        public setWords(words: boolean): void;
        public acceptWaveform(data: Readable|Buffer): boolean;
        public acceptWaveformAsync(data: Readable|Buffer): Promise<boolean>;
        public result(): RecognitionResults;
        public partialResult(): PartialResults;
        public finalResult(): RecognitionResults;
        public free(): void;
    }
}