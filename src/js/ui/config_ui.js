// js/ui/config_ui.js

(function () {
    const STORAGE_KEY = 'vidinfra_ai_key';
    const STORAGE_PROVIDER = 'vidinfra_ai_provider';

    document.addEventListener('DOMContentLoaded', () => {
        // 1) Add "Config" tab button
        const tabNav = document.querySelector('.tab-nav');
        if (tabNav) {
            const btn = document.createElement('button');
            btn.className = 'tab-button';
            btn.setAttribute('data-tab', 'config');
            btn.textContent = 'Config';
            tabNav.appendChild(btn);
        }

        // 2) Add Config tab pane
        const tabContent = document.querySelector('.tab-content');
        if (tabContent) {
            const pane = document.createElement('div');
            pane.className = 'tab-pane';
            pane.id = 'config-tab';
            pane.innerHTML = `
          <div class="config-section">
            <label for="providerSelect">Add your LLM API Key</label>
            <select id="providerSelect">
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="anthropic">Anthropic</option>
              <option value="mistral">Mistral</option>
            </select>
  
            <input type="password" id="apiKeyInput" placeholder="AI API Key" />
  
            <div class="config-actions">
              <button id="saveKeyBtn" class="save-btn">Save</button>
              <button id="clearKeyBtn" class="clear-btn">Clear Key</button>
            </div>
  
            <hr class="config-divider" />
          </div>
        `;
            tabContent.appendChild(pane);
        }

        // 3) Load stored values
        chrome.storage.local.get([STORAGE_KEY, STORAGE_PROVIDER], ({ [STORAGE_KEY]: key, [STORAGE_PROVIDER]: prov }) => {
            if (prov) document.getElementById('providerSelect').value = prov;
            if (key) document.getElementById('apiKeyInput').value = key;
        });

        // 4) Save handler
        document.getElementById('saveKeyBtn').addEventListener('click', () => {
            const key = document.getElementById('apiKeyInput').value;
            const provider = document.getElementById('providerSelect').value;
            chrome.storage.local.set({ [STORAGE_KEY]: key, [STORAGE_PROVIDER]: provider }, () => {
                // Optional: give feedback
                console.log('AI key & provider saved');
            });
        });

        // 5) Clear handler
        document.getElementById('clearKeyBtn').addEventListener('click', () => {
            chrome.storage.local.remove(STORAGE_KEY, () => {
                document.getElementById('apiKeyInput').value = '';
                console.log('AI key cleared');
            });
        });
    });
})();