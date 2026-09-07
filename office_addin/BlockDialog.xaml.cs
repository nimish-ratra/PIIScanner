using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PIISentinel.OfficeAddin
{
    public partial class BlockDialog : Window
    {
        public bool UserOverridden { get; private set; }
        public string OverrideReason { get; private set; }

        public BlockDialog(ClassificationResult result, string documentName)
        {
            InitializeComponent();
            UserOverridden = false;
            OverrideReason = string.Empty;

            ApplyResult(result, documentName);
        }

        private void ApplyResult(ClassificationResult result, string documentName)
        {
            TxtBadge.Text = result.badge ?? result.tier;
            TxtRationale.Text = result.rationale ?? "Sensitive PII detected.";

            // Style badge color based on tier
            string tier = (result.tier ?? "").ToLower();
            if (tier.Contains("restricted"))
            {
                BadgeBorder.Background = new SolidColorBrush(Color.FromRgb(46, 16, 101));
                BadgeBorder.BorderBrush = new SolidColorBrush(Color.FromRgb(168, 85, 247));
                TxtBadge.Foreground = new SolidColorBrush(Color.FromRgb(216, 180, 254));
            }
            else if (tier.Contains("highly"))
            {
                BadgeBorder.Background = new SolidColorBrush(Color.FromRgb(69, 10, 10));
                BadgeBorder.BorderBrush = new SolidColorBrush(Color.FromRgb(239, 68, 68));
                TxtBadge.Foreground = new SolidColorBrush(Color.FromRgb(254, 202, 202));
            }
            else
            {
                BadgeBorder.Background = new SolidColorBrush(Color.FromRgb(69, 26, 3));
                BadgeBorder.BorderBrush = new SolidColorBrush(Color.FromRgb(245, 158, 11));
                TxtBadge.Foreground = new SolidColorBrush(Color.FromRgb(253, 230, 138));
            }

            LstFindings.ItemsSource = result.findings;
        }

        private void TxtOverrideReason_TextChanged(object sender, TextChangedEventArgs e)
        {
            BtnConfirmOverride.IsEnabled = !string.IsNullOrWhiteSpace(TxtOverrideReason.Text) && TxtOverrideReason.Text.Trim().Length >= 5;
        }

        private void BtnConfirmOverride_Click(object sender, RoutedEventArgs e)
        {
            UserOverridden = true;
            OverrideReason = TxtOverrideReason.Text.Trim();
            DialogResult = true;
            Close();
        }

        private void BtnCancel_Click(object sender, RoutedEventArgs e)
        {
            UserOverridden = false;
            DialogResult = false;
            Close();
        }

        private void BtnOpenApp_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                string exePath = @"c:\PIISentinalApp\dist\PIISentinel\PIISentinel.exe";
                if (File.Exists(exePath))
                {
                    Process.Start(new ProcessStartInfo(exePath) { UseShellExecute = true });
                }
                else
                {
                    // Fallback to python main.py
                    Process.Start(new ProcessStartInfo("python", @"c:\PIISentinalApp\main.py") { UseShellExecute = true });
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not launch PII Sentinel: " + ex.Message, "PII Sentinel", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }
}
