import { NextResponse } from 'next/server'
import { PythonShell } from 'python-shell'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const period = searchParams.get('period')

  if (!symbol || !period) {
    return NextResponse.json({ error: 'Missing symbol or period parameter' }, { status: 400 })
  }

  try {
    const result = await new Promise((resolve, reject) => {
      PythonShell.run('crypto_statistics.py', {
        args: [symbol, period],
        pythonPath: 'python3', // Adjust this to your Python path if necessary
      }, (err, results) => {
        if (err) reject(err);
        resolve(results ? JSON.parse(results[0]) : null);
      });
    });

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching crypto stats:', error)
    return NextResponse.json({ error: 'Failed to fetch crypto statistics' }, { status: 500 })
  }
}

