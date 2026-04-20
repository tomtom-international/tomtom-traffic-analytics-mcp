#!/usr/bin/env node
/*
 * Copyright (C) 2025 TomTom NV
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Utility script to run the MCP Inspector with environment variables from .env file
 * This script reads TOMTOM_API_KEY and TOMTOM_MOVE_PORTAL_KEY from .env and passes them
 * to the MCP inspector command.
 */

function loadEnvFile() {
    const envPath = path.join(__dirname, '.env');
    
    if (!fs.existsSync(envPath)) {
        console.error('Error: .env file not found');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = {};

    // Parse .env file
    envContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, ...valueParts] = trimmedLine.split('=');
            if (key && valueParts.length > 0) {
                let value = valueParts.join('=');
                // Remove surrounding quotes if present
                value = value.replace(/^["']|["']$/g, '');
                envVars[key] = value;
            }
        }
    });

    return envVars;
}

function runInspector() {
    try {
        const envVars = loadEnvFile();
        
        const tomtomApiKey = envVars.TOMTOM_API_KEY;
        const tomtomMovePortalKey = envVars.TOMTOM_MOVE_PORTAL_KEY;

        if (!tomtomApiKey) {
            console.error('Error: TOMTOM_API_KEY not found in .env file');
            process.exit(1);
        }

        if (!tomtomMovePortalKey) {
            console.error('Error: TOMTOM_MOVE_PORTAL_KEY not found in .env file');
            process.exit(1);
        }

        console.log('Starting MCP Inspector with TomTom API keys...');
        console.log('API Key:', tomtomApiKey.substring(0, 8) + '...');
        console.log('Move Portal Key:', tomtomMovePortalKey.substring(0, 8) + '...');

        const command = `npx @modelcontextprotocol/inspector node bin/tomtom-traffic-analytics-mcp.js -e TOMTOM_API_KEY=${tomtomApiKey} -e TOMTOM_MOVE_PORTAL_KEY=${tomtomMovePortalKey}`;
        
        console.log('\nRunning command:');
        console.log(command.replace(tomtomApiKey, tomtomApiKey.substring(0, 8) + '...').replace(tomtomMovePortalKey, tomtomMovePortalKey.substring(0, 8) + '...'));
        console.log('');

        // Execute the command
        execSync(command, { 
            stdio: 'inherit',
            cwd: __dirname 
        });

    } catch (error) {
        console.error('Error running MCP Inspector:', error.message);
        process.exit(1);
    }
}


runInspector();

export { loadEnvFile, runInspector };
