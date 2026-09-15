import { useEffect, useState } from 'react'
import { applyPwaUpdate, getNeedRefresh, subscribeNeedRefresh } from '../lib/pwa'

export function UpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(() => getNeedRefresh())

  useEffect(() => subscribeNeedRefresh(setNeedRefresh), [])

  if (!needRefresh) return null

  return (
    <div className="update-banner banner" role="status">
      <span>A new version is ready.</span>
      <button className="primary" type="button" onClick={() => void applyPwaUpdate()}>
        Refresh
      </button>
    </div>
  )
}
