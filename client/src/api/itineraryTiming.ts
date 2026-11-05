import { assignmentSchema, daySchema, type AssignmentStayRequest, type DayTiming } from '@trek/shared'
import { apiClient } from './client'

export async function saveVisitStay(tripId: number | string, id: number, body: AssignmentStayRequest) {
  return assignmentSchema.parse((await apiClient.put(`/trips/${tripId}/assignments/${id}/stay`, body)).data.assignment)
}
export async function saveDayTiming(tripId: number | string, id: number, timing: DayTiming) {
  return daySchema.parse((await apiClient.put(`/trips/${tripId}/days/${id}/timing`, timing)).data.day)
}
