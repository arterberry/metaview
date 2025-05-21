// tests/cypress/e2e/external_player.spec.cy.js

describe('Metaview Player QoE Test via Node.js Script', () => {
    it('should run the Node.js script and validate QoE results from JSON', () => {
        
        // Dynamically generate a tokenized path from another test case
        const targetUrl = "https://qa-foxdtc-video.akamaized.net/live/fs1-ue2/index.m3u8?ad_env=1&bu=foxdtc&cdn=ak&channel=fs1-ue2&duration=1209600&hdnts=exp%3D1749057113~acl%3D%2F*~hmac%3D3a705d7efcc0517664c108562107521ceaf33d1eeaf019bb961d8afb5006791a"; 


        cy.log(`Invoking Node.js script for URL: ${targetUrl}`);

        // Cypress task timeout: 4 minutes (can be shorter)
        cy.task('runNodeScript', targetUrl, { timeout: 240000 }) 
            .then((qoeData) => {
                cy.log('Node.js script finished and QoE data received by Cypress.');
                expect(qoeData).to.be.an('object');

                // Example assertions on the QoE data:
                expect(qoeData).to.have.property('startTime').that.is.a('number');
                expect(qoeData).to.have.property('firstFrame').that.is.a('number');
                expect(qoeData).to.have.property('qualitySwitches').that.is.a('number');
                expect(qoeData).to.have.property('currentBitrate').that.is.a('number');
                expect(qoeData).to.have.property('currentResolution').that.is.a('string');
                expect(qoeData).to.have.property('rebufferingEvents').that.is.a('number');

                if (qoeData.rebufferingEvents > 0) {
                    expect(qoeData).to.have.property('rebufferingDurations').that.is.an('array').and.not.empty;
                }

                expect(qoeData).to.have.property('cdnProvider').that.is.a('string');
                expect(qoeData).to.have.property('eventHistory').that.is.an('array');

                cy.log('QoE Data Validated Successfully!');
                cy.log('Full QoE Data:', JSON.stringify(qoeData, null, 2)); 
            });
    });
});