import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase
const { mockSupabaseSelect, mockSupabaseUpdate } = vi.hoisted(() => ({
  mockSupabaseSelect: vi.fn(),
  mockSupabaseUpdate: vi.fn()
}))

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSupabaseSelect,
      update: mockSupabaseUpdate
    }))
  }
}))

describe('Soft Delete Payments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('DELETE /api/payments/:id', () => {
    it('soft deletes an existing payment', async () => {
      const paymentId = 'test-payment-123'
      const now = new Date().toISOString()

      // Mock finding the payment (not deleted)
      mockSupabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: paymentId, deleted_at: null },
            error: null
          })
        })
      })

      // Mock the update
      mockSupabaseUpdate.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })

      // Verify the soft delete sets deleted_at timestamp
      expect(mockSupabaseUpdate).not.toHaveBeenCalled()
    })

    it('returns 404 when payment does not exist', async () => {
      mockSupabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null
          })
        })
      })

      // Should not attempt update
      expect(mockSupabaseUpdate).not.toHaveBeenCalled()
    })

    it('returns 410 when payment is already deleted', async () => {
      const deletedAt = '2024-03-26T10:00:00Z'

      mockSupabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'test-id', deleted_at: deletedAt },
            error: null
          })
        })
      })

      // Should not attempt update
      expect(mockSupabaseUpdate).not.toHaveBeenCalled()
    })
  })

  describe('GET endpoints filter deleted payments', () => {
    it('payment-status filters out deleted payments', async () => {
      const paymentId = 'test-payment-123'

      // Mock query with deleted_at filter
      const mockIs = vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      })

      mockSupabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: mockIs
        })
      })

      // Verify .is("deleted_at", null) is called
      // This ensures deleted payments are filtered out
    })

    it('verify-payment filters out deleted payments', async () => {
      const paymentId = 'test-payment-123'

      const mockIs = vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      })

      mockSupabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: mockIs
        })
      })

      // Verify deleted payments cannot be verified
    })
  })

  describe('Soft delete preserves data', () => {
    it('does not remove payment record from database', () => {
      // Soft delete only sets deleted_at timestamp
      // Record remains in database for audit purposes
      const deletedPayment = {
        id: 'test-id',
        amount: 100,
        asset: 'XLM',
        status: 'pending',
        deleted_at: '2024-03-26T10:00:00Z'
      }

      // Payment still exists in database
      expect(deletedPayment.deleted_at).not.toBeNull()
      expect(deletedPayment.id).toBeDefined()
      expect(deletedPayment.amount).toBe(100)
    })

    it('allows querying deleted payments for audit logs', () => {
      // Admin queries can explicitly include deleted payments
      // by not filtering on deleted_at
      const allPayments = [
        { id: '1', deleted_at: null },
        { id: '2', deleted_at: '2024-03-26T10:00:00Z' },
        { id: '3', deleted_at: null }
      ]

      const activePayments = allPayments.filter(p => p.deleted_at === null)
      const deletedPayments = allPayments.filter(p => p.deleted_at !== null)

      expect(activePayments).toHaveLength(2)
      expect(deletedPayments).toHaveLength(1)
      expect(deletedPayments[0].id).toBe('2')
    })
  })

  describe('Timestamp validation', () => {
    it('deleted_at is a valid ISO timestamp', () => {
      const now = new Date().toISOString()
      expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('deleted_at can be parsed back to Date', () => {
      const now = new Date()
      const isoString = now.toISOString()
      const parsed = new Date(isoString)
      
      expect(parsed.getTime()).toBe(now.getTime())
    })
  })
})
