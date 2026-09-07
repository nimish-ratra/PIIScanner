using System;
using System.Runtime.InteropServices;
using Extensibility;
using Word = Microsoft.Office.Interop.Word;
using Excel = Microsoft.Office.Interop.Excel;

namespace PIISentinel.OfficeAddin
{
    [ComVisible(true)]
    [Guid("E54C2817-A109-4D1C-8472-D752CE622341")]
    [ProgId("PIISentinel.OfficeAddin")]
    public class ThisAddIn : IDTExtensibility2
    {
        private ApiClient _apiClient;
        private WordSaveGuard _wordGuard;
        private ExcelSaveGuard _excelGuard;
        private object _appObject;

        public ThisAddIn()
        {
            _apiClient = new ApiClient();
        }

        public void OnConnection(object Application, ext_ConnectMode ConnectMode, object AddInInst, ref Array custom)
        {
            _appObject = Application;

            try
            {
                // Detect host office application (C# 5 compatible casting)
                Word.Application wordApp = Application as Word.Application;
                if (wordApp != null)
                {
                    _wordGuard = new WordSaveGuard(wordApp, _apiClient);
                    _wordGuard.Hook();
                }
                else
                {
                    Excel.Application excelApp = Application as Excel.Application;
                    if (excelApp != null)
                    {
                        _excelGuard = new ExcelSaveGuard(excelApp, _apiClient);
                        _excelGuard.Hook();
                    }
                }
            }
            catch (Exception ex)
            {
                // Fail silently to avoid interfering with user's normal office startup
                System.Diagnostics.Debug.WriteLine("PII Sentinel AddIn connection error: " + ex);
            }
        }

        public void OnDisconnection(ext_DisconnectMode RemoveMode, ref Array custom)
        {
            try
            {
                if (_wordGuard != null)
                {
                    _wordGuard.Unhook();
                    _wordGuard = null;
                }
                if (_excelGuard != null)
                {
                    _excelGuard.Unhook();
                    _excelGuard = null;
                }
            }
            catch { }

            _appObject = null;
        }

        public void OnStartupComplete(ref Array custom) { }

        public void OnBeginShutdown(ref Array custom) { }

        public void OnAddInsUpdate(ref Array custom) { }
    }
}
