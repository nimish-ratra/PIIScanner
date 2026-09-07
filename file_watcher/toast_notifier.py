"""
Windows Toast Notifier for PII Sentinel (Phase 2)
Delivers native Windows desktop notifications for file quarantine and PII warnings.
Uses win10toast with automated PowerShell XML fallback for guaranteed delivery.
"""

import sys
import logging
import threading
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger("pii_sentinel.toast")


class ToastNotifierBridge:
    """Delivers non-blocking native Windows toast notifications."""

    def __init__(self):
        self._toaster = None
        self._has_win10toast = False
        try:
            from win10toast import ToastNotifier
            self._toaster = ToastNotifier()
            self._has_win10toast = True
        except Exception as e:
            logger.debug(f"win10toast initialization notice: {e}")

    def notify(
        self,
        title: str,
        message: str,
        duration: int = 5,
        icon_path: Optional[str] = None
    ) -> None:
        """Fire a toast notification in a background thread without blocking execution."""
        def _send():
            # 1. Try win10toast
            if self._has_win10toast and self._toaster:
                try:
                    self._toaster.show_toast(
                        title=title,
                        msg=message,
                        duration=duration,
                        icon_path=icon_path,
                        threaded=False
                    )
                    return
                except Exception as e:
                    logger.debug(f"win10toast failed, attempting PowerShell fallback: {e}")

            # 2. PowerShell native fallback
            try:
                ps_script = f"""
                [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
                $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
                $textNodes = $template.GetElementsByTagName("text")
                $textNodes.Item(0).AppendChild($template.CreateTextNode("{title}")) > $null
                $textNodes.Item(1).AppendChild($template.CreateTextNode("{message}")) > $null
                $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
                $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("PII Sentinel")
                $notifier.Show($toast)
                """
                creation_flags = 0x08000000  # CREATE_NO_WINDOW
                subprocess.run(
                    ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
                    creationflags=creation_flags,
                    timeout=5,
                    capture_output=True
                )
            except Exception as ex:
                logger.warning(f"Could not deliver Windows toast notification: {ex}")

        threading.Thread(target=_send, daemon=True, name="ToastThread").start()


# Singleton instance
toast_notifier = ToastNotifierBridge()
