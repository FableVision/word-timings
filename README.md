# Word Timings Generator
Uses [Vosk](https://alphacephei.com/vosk/) to analyze audio files and generate word timings.

## Usage
`npx word-timings -c ./path/to/my-config.json`

Uses a configuration file in the format:
```javascript
{
    "model": "path/to/model", // Path to the model you've downloaded and unzipped.
    "cache": "path/to/.cachefile", // Optional, name a cache file to use instead of the default. This speeds up later runs.
    "pretty": true, // Optional - if true, pretty prints the output
    "outputs": [
        {
            "file": "path/to/output.json", // path for the output for this group of files
            "globs": ["path/to/*.wav"] // globs of files to batch together into this output
        }
    ]
}
```
Audio files must be mono PCM .wav files, and are suggested to run in 16khz (although higher sample rates seem to work okay).

## Output
Output will be a JSON dictionary of filenames (no path or extension) to arrays of time data.
```javascript
{
    "myfile": [[0.1, 0.3], 0.4, 0.5, 0.6, [0.8, 1.2]]
}
```
Time data is an array, where every element is either a tuple representing the start & end time of that word, or a number representing the end time of the word with the start time being the previous word's end time. All times are in seconds.