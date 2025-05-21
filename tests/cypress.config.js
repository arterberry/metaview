// tests/cypress.config.js
const { defineConfig } = require('cypress');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

module.exports = defineConfig({
	e2e: {
		// baseUrl: 'http://localhost:3000', 
		specPattern: 'cypress/e2e/**/*.spec.cy.js', 
		supportFile: false,
		fixturesFolder: 'cypress/fixtures',
		screenshotsFolder: 'cypress/screenshots',
		videosFolder: 'cypress/videos',
		downloadsFolder: 'cypress/downloads',

		setupNodeEvents(on, config) {
			on('task', {
				runNodeScript: (urlToTest) => {
					return new Promise((resolve, reject) => {
						if (!urlToTest) {
							return reject(new Error('URL to test is required for runNodeScript task'));
						}
						const scriptPath = path.join(__dirname, 'test_wrapper', 'test-cdp-basic.js'); 
						const command = `node "${scriptPath}" "${urlToTest}"`;

						console.log(`Cypress task: Executing command: ${command}`);

						exec(command, (error, stdout, stderr) => {
							console.log(`Cypress task: Node script stdout: ${stdout}`);
							if (stderr) {
								console.error(`Cypress task: Node script stderr: ${stderr}`);
							}
							if (error) {
								console.error(`Cypress task: Node script execution error: ${error.message}`);
								return reject(new Error(`Node script failed: ${error.message}\nStderr: ${stderr}`));
							}
							// JSON in the project root 
							const resultsFilePath = path.join(__dirname, 'qoe_results.json');   

							console.log(`Cypress task: Checking for results file at: ${resultsFilePath}`);
							return fs.readFile(resultsFilePath, 'utf8')
								.then(data => {
									console.log('Cypress task: Successfully read qoe_results.json');
									resolve(JSON.parse(data)); 
								})
								.catch(fileReadError => {
									console.error(`Cypress task: Error reading qoe_results.json: ${fileReadError}`);
									reject(new Error(`Failed to read results file: ${resultsFilePath}. Error: ${fileReadError.message}. Node script stdout: ${stdout}. Node script stderr: ${stderr}`));
								});
						});
					});
				},
			});
			return config;
		},
	},
});