import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request) {
    try {
        const { text, source, target } = await request.json();

        if (!text) {
            return NextResponse.json({ translatedText: '' });
        }

        const scriptPath = path.join(process.cwd(), 'scripts', 'translate_text.py');

        // Spawn python process
        // We assume 'python' is in path. If not, might need specific path.
        const pythonProcess = spawn('python', [scriptPath]);

        const inputData = JSON.stringify({ text, source, target });

        let result = '';
        let error = '';

        return new Promise((resolve) => {
            pythonProcess.stdout.on('data', (data) => {
                result += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                error += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    resolve(NextResponse.json({ error: `Process exited with code ${code}: ${error}` }, { status: 500 }));
                } else {
                    // Result likely contains newline at end, trim it
                    resolve(NextResponse.json({ translatedText: result.trim() }));
                }
            });

            // Write data to stdin
            pythonProcess.stdin.write(inputData);
            pythonProcess.stdin.end();
        });

    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
