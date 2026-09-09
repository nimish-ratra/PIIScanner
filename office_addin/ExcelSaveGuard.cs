using System;
using System.Text;
using System.Windows;
using Excel = Microsoft.Office.Interop.Excel;

namespace PIISentinel.OfficeAddin
{
    public class ExcelSaveGuard
    {
        private readonly Excel.Application _excelApp;
        private readonly ApiClient _apiClient;
        private bool _isHooked;

        public ExcelSaveGuard(Excel.Application excelApp, ApiClient apiClient)
        {
            _excelApp = excelApp;
            _apiClient = apiClient;
            _isHooked = false;
        }

        public void Hook()
        {
            if (!_isHooked && _excelApp != null)
            {
                _excelApp.WorkbookBeforeSave += ExcelApp_WorkbookBeforeSave;
                _isHooked = true;
            }
        }

        public void Unhook()
        {
            if (_isHooked && _excelApp != null)
            {
                try
                {
                    _excelApp.WorkbookBeforeSave -= ExcelApp_WorkbookBeforeSave;
                }
                catch { }
                _isHooked = false;
            }
        }

        private void ExcelApp_WorkbookBeforeSave(Excel.Workbook wb, bool SaveAsUI, ref bool Cancel)
        {
            if (wb == null) return;

            string wbName = "Workbook.xlsx";
            try { wbName = wb.Name; } catch { }

            // 1. Extract spreadsheet content in memory across worksheets
            var textBuilder = new StringBuilder();
            try
            {
                foreach (Excel.Worksheet sheet in wb.Worksheets)
                {
                    if (sheet == null) continue;
                    Excel.Range usedRange = sheet.UsedRange;
                    if (usedRange != null)
                    {
                        object[,] values = usedRange.Value2 as object[,];
                        if (values != null)
                        {
                            int rowCount = values.GetLength(0);
                            int colCount = values.GetLength(1);
                            for (int r = 1; r <= rowCount && r <= 1000; r++)
                            {
                                for (int c = 1; c <= colCount && c <= 50; c++)
                                {
                                    object cellVal = values[r, c];
                                    if (cellVal != null)
                                    {
                                        textBuilder.Append(cellVal.ToString()).Append(" ");
                                    }
                                }
                                textBuilder.AppendLine();
                            }
                        }
                    }
                }
            }
            catch { }

            string text = textBuilder.ToString();
            if (string.IsNullOrWhiteSpace(text) || text.Trim().Length < 4)
            {
                return; // Nothing to scan
            }

            // 2. Classify text via local microservice
            ClassificationResult result = _apiClient.ClassifyText(text, "Microsoft Excel: " + wbName);

            if (result.recommended_action == "allow")
            {
                return; // Fast path
            }

            var summaryBuilder = new StringBuilder();
            foreach (var item in result.findings)
            {
                if (summaryBuilder.Length > 0) summaryBuilder.Append(", ");
                summaryBuilder.Append(item.entity_type);
            }
            string entitySummary = summaryBuilder.ToString();
            string wbPath = string.Empty;
            try { wbPath = wb.FullName; } catch { wbPath = wbName; }

            // 3. Handle Block Action
            if (result.recommended_action == "block")
            {
                bool userOverridden = false;
                string overrideReason = string.Empty;

                try
                {
                    var dialog = new BlockDialog(result, wbName);
                    bool? dialogRes = dialog.ShowDialog();
                    userOverridden = dialog.UserOverridden;
                    overrideReason = dialog.OverrideReason;
                }
                catch (Exception)
                {
                    userOverridden = false;
                }

                if (userOverridden)
                {
                    Cancel = false; // Override approved
                    try
                    {
                        _apiClient.LogEnforcement(wbPath, result.tier, "override", true, overrideReason, entitySummary, "Office Add-in (Excel)", "Excel", entitySummary);
                    }
                    catch { }
                }
                else
                {
                    Cancel = true;
                    try
                    {
                        _apiClient.LogEnforcement(wbPath, result.tier, "block", false, string.Empty, entitySummary, "Office Add-in (Excel)", "Excel", entitySummary);
                    }
                    catch { }
                }
            }
            // 4. Handle Warn Action
            else if (result.recommended_action == "warn")
            {
                _apiClient.LogEnforcement(wbPath, result.tier, "warn", false, string.Empty, entitySummary, "Office Add-in (Excel)");
                MessageBox.Show(
                    "⚠️ PII Sentinel Notice:\n\n" +
                    "This workbook contains " + result.tier + " personal data (" + entitySummary + ").\n" +
                    "Save will proceed, but this event has been logged to the security audit trail.",
                    "PII Sentinel — Save Warning",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning
                );
            }
        }
    }
}
