import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const token = process.env["GITHUB_TOKEN"];
if (!token) {
    console.error("Error: no GITHUB_TOKEN environment variable");
    process.exit(1);
}

const endpoint = "https://models.github.ai/inference";
const model = "deepseek/DeepSeek-V3-0324";

// Requests per minute: 10
// Requests per day: 50
const SLEEP_DURATION_MS = 6500;
const MAX_DAILY_REQUESTS = 50;

// model hyper-params
const TEMPERATURE = 1.0;
const TOP_P = 1.0;
const MAX_TOKENS = 500;

const EMOTION_CATEGORIES = [
    'Control', 'Formal', 'Casual', 'Confident',
    'Hesitant', 'Analytical', 'Emotional', 'Optimistic', 'Pessimistic'
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function loadProgress() {
    // store and restore progress
    try {
        if (fs.existsSync('deepseek_progress.json')) {
        const progress = JSON.parse(fs.readFileSync('deepseek_progress.json', 'utf8'));
        console.log(`Resuming from question ${progress.questionIndex}, category ${progress.categoryIndex}`);
        return progress;
        }
    } catch (err) {
        console.log('Starting from beginning');
    }
    return { questionIndex: 0, categoryIndex: 0, totalRequests: 0, results: {} };
}

function saveProgress(questionIndex, categoryIndex, totalRequests, results) {
    const progress = { questionIndex, categoryIndex, totalRequests, results };
    fs.writeFileSync('testing_progress_deepseek.json', JSON.stringify(progress, null, 2));
}

function saveResults(results) {
    fs.writeFileSync('responses_deepseek.json', JSON.stringify(results, null, 2));
    console.log('✅ Results saved to responses_deepseek.json');
}

export async function main() {
    const client = ModelClient(
        endpoint,
        new AzureKeyCredential(token),
    );

    // Load questions database
    const questionsDatabase = JSON.parse(fs.readFileSync('questions_database.json', 'utf8'));
    
    // Load or initialize progress
    let { questionIndex, categoryIndex, totalRequests, results } = loadProgress();
    
    // Initialize results structure if empty
    if (Object.keys(results).length === 0) {
        EMOTION_CATEGORIES.forEach(category => {
        results[category] = [];
        });
    }

  console.log(`\n -------Starting DeepSeek API processing-----`);

  try {
    for (let qIdx = questionIndex; qIdx < questionsDatabase.length; qIdx++) {
        const questionEntry = questionsDatabase[qIdx];
        
        for (let cIdx = (qIdx === questionIndex ? categoryIndex : 0); cIdx < EMOTION_CATEGORIES.length; cIdx++) {
            const category = EMOTION_CATEGORIES[cIdx];
            
            if (totalRequests >= MAX_DAILY_REQUESTS) {
            console.log(`\n Daily limit reached at question ${qIdx}, category ${category}`);
            saveProgress(qIdx, cIdx, totalRequests, results);
            saveResults(results);
            return;
            }

        const prompt = questionEntry[category];
        
        console.log(`[${totalRequests + 1}/${MAX_DAILY_REQUESTS}] Q${qIdx + 1}/${questionsDatabase.length} - ${category}`);
        
        try {
            const response = await client.path("/chat/completions").post({
                body: {
                messages: [
                    { role: "system", content: "You are a helpful assistant." },
                    { role: "user", content: prompt }
                ],
                temperature: TEMPERATURE,
                top_p: TOP_P,
                max_tokens: MAX_TOKENS,
                model: model
                }
            });

            if (isUnexpected(response)) {
                const errorMsg = response.body.error || 'Unknown error';
                    console.log(`Error: ${errorMsg}`);
                    // Not pushing to results
                    // results[category].push({
                    //   prompt: prompt,
                    //   response: null,
                    //   error: errorMsg
                    // });
            } else {
                const content = response.body.choices[0].message.content;
                console.log(`Responded`);
                results[category].push({
                prompt: prompt,
                response: content
                });
            }
        } catch (err) {
            console.log(`Exception: ${err.message}`);
            results[category].push({
                prompt: prompt,
                response: null,
                error: err.message
            });
        }

        totalRequests++;
        
        // Save progress after each request
        saveProgress(qIdx, cIdx + 1, totalRequests, results);
        
        // Sleep to respect rate limits (except for the last request)
        if (totalRequests < MAX_DAILY_REQUESTS && 
                !(qIdx === questionsDatabase.length - 1 && cIdx === EMOTION_CATEGORIES.length - 1)) {
            await sleep(SLEEP_DURATION_MS);
            }
        }
    }

    console.log(`\n Total requests made: ${totalRequests}`);
    saveResults(results);
    
    // Clean up progress file on successful completion
    if (fs.existsSync('deepseek_progress.json')) {
      fs.unlinkSync('deepseek_progress.json');
      console.log('🧹 Progress file cleaned up');
    }

  } catch (err) {
    console.error(`\n Fatal error: ${err.message}`);
    saveProgress(questionIndex, categoryIndex, totalRequests, results);
    saveResults(results);
    throw err;
  }
}

main().catch((err) => {
  console.error("The sample encountered an error:", err);
});
