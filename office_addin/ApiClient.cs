using System;
using System.IO;
using System.Net;
using System.Text;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace PIISentinel.OfficeAddin
{
    public class FindingItem
    {
        public string entity_type { get; set; }
        public string redacted_value { get; set; }
        public double confidence { get; set; }
        public int start { get; set; }
        public int end { get; set; }
    }

    public class ClassificationResult
    {
        public string tier { get; set; }
        public int level { get; set; }
        public string badge { get; set; }
        public List<FindingItem> findings { get; set; }
        public string recommended_action { get; set; }
        public string rationale { get; set; }
        public int total_findings { get; set; }
        public bool is_error { get; set; }
        public string error_message { get; set; }

        public ClassificationResult()
        {
            findings = new List<FindingItem>();
            recommended_action = "allow";
            tier = "General";
            badge = "⚪ General";
            rationale = "Default fallback";
        }
    }

    public class ApiClient
    {
        private readonly string _baseUrl;
        private readonly int _timeoutMs;
        private readonly bool _failOpen;
        private readonly JavaScriptSerializer _serializer;

        public ApiClient(string baseUrl = "http://127.0.0.1:47821", int timeoutMs = 3000, bool failOpen = false)
        {
            _baseUrl = baseUrl.TrimEnd('/');
            _timeoutMs = timeoutMs;
            _failOpen = failOpen;
            _serializer = new JavaScriptSerializer();
        }

        public ClassificationResult ClassifyText(string text, string sourceHint = "Microsoft Office")
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return new ClassificationResult { recommended_action = "allow", tier = "General", badge = "⚪ General" };
            }

            try
            {
                var request = (HttpWebRequest)WebRequest.Create(_baseUrl + "/classify/text");
                request.Method = "POST";
                request.ContentType = "application/json; charset=utf-8";
                request.Timeout = _timeoutMs;
                request.ReadWriteTimeout = _timeoutMs;

                var payload = new Dictionary<string, object>
                {
                    { "text", text },
                    { "source_hint", sourceHint }
                };

                byte[] bodyBytes = Encoding.UTF8.GetBytes(_serializer.Serialize(payload));
                request.ContentLength = bodyBytes.Length;

                using (var stream = request.GetRequestStream())
                {
                    stream.Write(bodyBytes, 0, bodyBytes.Length);
                }

                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string json = reader.ReadToEnd();
                    var result = _serializer.Deserialize<ClassificationResult>(json);
                    return result ?? new ClassificationResult();
                }
            }
            catch (Exception ex)
            {
                // Service unreachable or timed out -> Apply fail-safe policy
                if (_failOpen)
                {
                    return new ClassificationResult
                    {
                        recommended_action = "allow",
                        tier = "General",
                        badge = "⚪ General (Fail-Open)",
                        rationale = "Service unreachable, save permitted under Fail-Open policy.",
                        is_error = true,
                        error_message = ex.Message
                    };
                }
                else
                {
                    return new ClassificationResult
                    {
                        recommended_action = "block",
                        tier = "Highly Confidential",
                        badge = "🔴 Fail-Closed Protection",
                        rationale = "PII Sentinel enforcement service is unreachable (Fail-Closed active to prevent uninspected PII leaks).",
                        is_error = true,
                        error_message = ex.Message
                    };
                }
            }
        }

        public bool LogEnforcement(string filePath, string tier, string actionTaken, bool userOverride, string overrideReason, string entitySummary, string source)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(_baseUrl + "/enforcement/log");
                request.Method = "POST";
                request.ContentType = "application/json; charset=utf-8";
                request.Timeout = 2000;

                var payload = new Dictionary<string, object>
                {
                    { "file_path", filePath ?? "Untitled Document" },
                    { "tier", tier ?? "General" },
                    { "action_taken", actionTaken ?? "block" },
                    { "user_override", userOverride },
                    { "override_reason", overrideReason ?? "" },
                    { "entity_summary", entitySummary ?? "" },
                    { "source", source ?? "Office Add-in" }
                };

                byte[] bodyBytes = Encoding.UTF8.GetBytes(_serializer.Serialize(payload));
                request.ContentLength = bodyBytes.Length;

                using (var stream = request.GetRequestStream())
                {
                    stream.Write(bodyBytes, 0, bodyBytes.Length);
                }

                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }
    }
}
