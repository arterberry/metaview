// js/ui/config_ui.js
document.addEventListener('DOMContentLoaded', () => {
    const tabButtons = document.querySelectorAll('.config-tab-button');
    const tabPanes = document.querySelectorAll('.config-tab-pane');

    const drmTokenInput = document.getElementById('drmTokenInput');
    const drmTokenStatus = document.getElementById('drmTokenStatus');
    const saveDrmTokenButton = document.getElementById('saveDrmTokenButton');

    const llmProviderSelect = document.getElementById('llmProviderSelect');
    const llmApiKeyInput = document.getElementById('llmApiKeyInput');
    const llmApiKeyStatus = document.getElementById('llmApiKeyStatus');
    const saveLlmApiKeyButton = document.getElementById('saveLlmApiKeyButton');

    if (tabButtons.length > 0 && tabPanes.length > 0) {
        tabButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanes.forEach(pane => pane.classList.remove('active'));
                event.currentTarget.classList.add('active');
                const targetTabValue = event.currentTarget.getAttribute('data-tab');
                const targetPaneElement = document.getElementById(targetTabValue + '-tab');
                if (targetPaneElement) {
                    targetPaneElement.classList.add('active');
                }
            });
        });
    } else {
        return;
    }

    function showStatusMessage(element, message, isError = false, duration = 2500) {
        if (element) {
            element.textContent = message;
            element.style.color = isError ? '#e1a598' : '#8fdf8f'; // Red for error, green for success
            setTimeout(() => {
                element.textContent = '';
            }, duration);
        }
    }

    if (drmTokenInput && drmTokenStatus && saveDrmTokenButton) {
        chrome.storage.local.get(['drmAuthToken'], (result) => {
            if (result.drmAuthToken) {
                drmTokenInput.value = result.drmAuthToken;
            }
        });

        saveDrmTokenButton.addEventListener('click', () => {
            const token = drmTokenInput.value.trim();
            if (token) {
                chrome.storage.local.set({ drmAuthToken: token }, () => {
                    showStatusMessage(drmTokenStatus, 'Token saved!');
                });
            } else {
                showStatusMessage(drmTokenStatus, 'Token cannot be empty.', true);
            }
        });
    }

    if (llmProviderSelect && llmApiKeyInput && llmApiKeyStatus && saveLlmApiKeyButton) {
        chrome.storage.local.get(['selectedLLMProvider', 'llmApiKey'], (result) => {
            if (result.selectedLLMProvider) {
                llmProviderSelect.value = result.selectedLLMProvider;
            }
            if (result.llmApiKey) {
                llmApiKeyInput.value = result.llmApiKey;
            }
        });

        saveLlmApiKeyButton.addEventListener('click', () => {
            const provider = llmProviderSelect.value;
            const apiKey = llmApiKeyInput.value.trim();

            if (!provider) {
                showStatusMessage(llmApiKeyStatus, 'Please select an LLM provider.', true);
                return;
            }
            if (!apiKey) {
                showStatusMessage(llmApiKeyStatus, 'API Key cannot be empty.', true);
                return;
            }

            chrome.storage.local.set({ selectedLLMProvider: provider, llmApiKey: apiKey }, () => {
                showStatusMessage(llmApiKeyStatus, 'LLM settings saved!');
            });
        });
    }
});