import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from './Button'

const KAKAO_OPENCHAT_URL = 'https://open.kakao.com/o/gbBkPehi'

export default function DiagnosticModal({
  open,
  onClose,
  onRetry
}: {
  open: boolean
  onClose: () => void
  onRetry?: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation('management')
  const [text, setText] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const run = async (): Promise<void> => {
      setLoading(true)
      setCopied(false)
      try {
        const report = await window.electronAPI.diagnostic.collect()
        if (cancelled) return
        setText(report.text)
      } catch {
        if (cancelled) return
        setText('<failed to collect diagnostic info>')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open])

  const handleCopy = async (): Promise<void> => {
    const result = await window.electronAPI.diagnostic.copy(text)
    if (result.success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-2xl mx-4 p-6 space-y-4">
        <div>
          <h3 className="text-base font-black">{t('done.failureModal.title')}</h3>
          <p className="text-sm text-text-muted mt-2">{t('done.failureModal.body')}</p>
        </div>

        <div className="bg-bg-card border border-text-muted/20 rounded-md p-3 max-h-64 overflow-auto">
          <pre className="text-[11px] text-text-muted whitespace-pre-wrap font-mono">
            {loading ? '...' : text}
          </pre>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('done.failureModal.retry')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('modal.close')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.open(KAKAO_OPENCHAT_URL, '_blank')}
          >
            {t('done.failureModal.openKakao')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleCopy} disabled={loading}>
            {copied ? t('done.diagnosticCopied') : t('done.failureModal.copy')}
          </Button>
        </div>
      </div>
    </div>
  )
}
