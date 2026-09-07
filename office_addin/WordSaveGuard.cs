using System;
using System.Text;
using System.Windows;
using Word = Microsoft.Office.Interop.Word;

namespace PIISentinel.OfficeAddin
{
    public class WordSaveGuard
    {
        private readonly Word.Application _wordApp;
        private readonly ApiClient _apiClient;
        private bool _isHooked;

        public WordSaveGuard(Word.Application wordApp, ApiClient apiClient)
        {
            _wordApp = wordApp;
            _apiClient = apiClient;
            _isHooked = false;
        }

        public void Hook()
        {
            if (!_isHooked && _wordApp != null)
            {
                _wordApp.DocumentBeforeSave += WordApp_DocumentBeforeSave;
                _isHooked = true;
            }
        }

        public void Unhook()
        {
            if (_isHooked && _wordApp != null)
            {
                try
                {
                    _wordApp.DocumentBeforeSave -= WordApp_DocumentBeforeSave;
                }
                catch { }
                _isHooked = false;
            }
        }

        private void WordApp_DocumentBeforeSave(Word.Document doc, ref bool SaveAsUI, ref bool Cancel)
        {
            if (doc == null) return;

            string docName = "Untitled.docx";
            try { docName = doc.Name; } catch { }

            // 1. Extract document text in-memory (zero disk writing)
            string text = string.Empty;
            try
            {
                if (doc.Content != null)
                {
                    text = doc.Content.Text ?? string.Empty;
                }
            }
            catch (Exception)
            {
                // If content extraction fails, fail-safe per policy
                text = string.Empty;
            }

            if (string.IsNullOrWhiteSpace(text) || text.Trim().Length < 4)
            {
                return; // Nothing to scan
            }

            // 2. Classify text via local microservice (3s timeout)
            ClassificationResult result = _apiClient.ClassifyText(text, "Microsoft Word: " + docName);

            if (result.recommended_action == "allow")
            {
                // Fast path: save proceeds immediately with no UI delay
                return;
            }

            // Summarize entities for audit trail
            var summaryBuilder = new StringBuilder();
            foreach (var item in result.findings)
            {
                if (summaryBuilder.Length > 0) summaryBuilder.Append(", ");
                summaryBuilder.Append(item.entity_type);
            }
            string entitySummary = summaryBuilder.ToString();
            string docPath = string.Empty;
            try { docPath = doc.FullName; } catch { docPath = docName; }

            // 3. Handle Block Action
            if (result.recommended_action == "block")
            {
                Cancel = true; // Prevent save immediately

                // Show WPF BlockDialog modal
                var dialog = new BlockDialog(result, docName);
                bool? dialogRes = dialog.ShowDialog();

                if (dialog.UserOverridden)
                {
                    // User supplied valid override justification
                    Cancel = false; // Allow save to proceed
                    _apiClient.LogEnforcement(docPath, result.tier, "override", true, dialog.OverrideReason, entitySummary, "Office Add-in (Word)");
                }
                else
                {
                    // Save remains blocked
                    Cancel = true;
                    _apiClient.LogEnforcement(docPath, result.tier, "block", false, string.Empty, entitySummary, "Office Add-in (Word)");
                }
            }
            // 4. Handle Warn Action
            else if (result.recommended_action == "warn")
            {
                _apiClient.LogEnforcement(docPath, result.tier, "warn", false, string.Empty, entitySummary, "Office Add-in (Word)");
                // Informational prompt without canceling
                MessageBox.Show(
                    "⚠️ PII Sentinel Notice:\n\n" +
                    "This document contains " + result.tier + " personal data (" + entitySummary + ").\n" +
                    "Save will proceed, but this action has been recorded in the local security audit log.",
                    "PII Sentinel — Save Warning",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning
                );
            }
        }
    }
}
