import { useEffect } from 'react'
import { useTripStore } from '../store/tripStore'
import { joinTrip, leaveTrip, addListener, removeListener } from '../api/websocket'
import type { WebSocketEvent } from '../types'
import type { ToursInvalidation } from './useTourPlaceIds'

export function useTripWebSocket(tripId: number | string | undefined, onToursChanged?: (change?: ToursInvalidation) => void) {
  useEffect(() => {
    if (!tripId) return
    const { handleRemoteEvent, loadFiles } = useTripStore.getState()
    joinTrip(tripId)
    addListener(handleRemoteEvent)
    const collabFileSync = (event: WebSocketEvent) => {
      if (event?.type === 'collab:note:deleted' || event?.type === 'collab:note:updated') {
        void loadFiles(tripId)
      }
    }
    addListener(collabFileSync)
    const refreshTripViews = (event: WebSocketEvent) => {
      if (String(event?.tripId ?? '') !== String(tripId)) return
      const { type } = event
      if (type === 'tours:changed') {
        const placeIds = Array.isArray(event.placeIds)
          ? event.placeIds.map(Number).filter(Number.isSafeInteger)
          : []
        onToursChanged?.(placeIds.length ? { placeIds } : undefined)
      } else if (type === 'place:deleted') {
        const placeId = Number(event.placeId)
        onToursChanged?.(Number.isSafeInteger(placeId) ? { removedPlaceIds: [placeId] } : undefined)
      } else if (type === 'assignment:created' || type === 'assignment:deleted' || type === 'day:deleted') {
        onToursChanged?.()
      } else if (type === 'guest:identity-transferred') {
        useTripStore.getState().refreshTransferredGuest(tripId, 'remote')
      } else if (type === 'budget:exchange-rates-applied' || type === 'budget:exchange-rates-updated') {
        useTripStore.getState().refreshExchangeRates(tripId, type === 'budget:exchange-rates-applied', 'remote')
      }
    }
    addListener(refreshTripViews)
    const localFileSync = () => { void loadFiles(tripId) }
    window.addEventListener('collab-files-changed', localFileSync)
    return () => {
      leaveTrip(tripId)
      removeListener(handleRemoteEvent)
      removeListener(collabFileSync)
      removeListener(refreshTripViews)
      window.removeEventListener('collab-files-changed', localFileSync)
    }
  }, [tripId, onToursChanged])
}
