import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { fmtTime, OCCASIONS, toDateInput } from '../../lib/format';
import type { Availability, Reservation } from '../../lib/types';
import { Button, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui';

export const tablesText = (r: Pick<Reservation, 'tables'>) =>
  typeof r.tables === 'string' ? r.tables || 'To be assigned' : r.tables?.length ? r.tables.map((t) => t.table_number).join(', ') : 'To be assigned';

/** Build an .ics calendar file for the booking. */
export function downloadIcs(r: Reservation & { restaurant_name?: string; branch_name?: string; branch_address?: string }) {
  const fmt = (s: string) => s.replace(/[-:]/g, '').slice(0, 15);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartRMS//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${r.booking_code}@smartrms`,
    `DTSTART:${fmt(r.start_at)}`,
    `DTEND:${fmt(r.end_at)}`,
    `SUMMARY:Table at ${r.restaurant_name || 'restaurant'} (${r.guests} guests)`,
    `LOCATION:${[r.branch_name, r.branch_address].filter(Boolean).join(', ')}`,
    `DESCRIPTION:Booking ${r.booking_code}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${r.booking_code}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Customer modify-booking modal: re-checks live availability (excluding this booking). */
export function ModifyBookingModal({ booking, open, onClose, onSaved }: { booking: Reservation; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(booking.booking_date);
  const [guests, setGuests] = useState(booking.guests);
  const [time, setTime] = useState(booking.start_at.slice(11, 16));
  const [occasion, setOccasion] = useState(booking.occasion || '');
  const [requests, setRequests] = useState(booking.special_requests || '');
  const [avail, setAvail] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get<Availability>(`/public/branches/${booking.branch_id}/availability`, { date, guests, excludeReservationId: booking.id })
      .then(setAvail)
      .catch((e) => {
        setAvail(null);
        toast.error(e.message);
      })
      .finally(() => setLoading(false));
  }, [open, date, guests, booking.branch_id, booking.id]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/customer/bookings/${booking.id}`, { date, time, guests, occasion: occasion || null, special_requests: requests });
      toast.success('Booking updated');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const slotOk = avail?.slots.find((s) => s.time === time)?.available;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Modify booking"
      description={`Booking ${booking.booking_code}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} disabled={!slotOk} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">
            <Input type="date" value={date} min={toDateInput()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Guests">
            <Input type="number" min={1} max={50} value={guests} onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        </div>
        <div>
          <p className="label">Time</p>
          {loading ? (
            <Spinner />
          ) : avail?.closed ? (
            <p className="text-sm text-red-600">{avail.reason}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {avail?.slots.map((s) => (
                <button
                  key={s.time}
                  disabled={!s.available}
                  onClick={() => setTime(s.time)}
                  className={clsx('rounded-lg border px-1 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40', time === s.time ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 hover:border-brand-400')}
                >
                  {fmtTime(s.time)}
                </button>
              ))}
            </div>
          )}
          {!loading && avail && !slotOk && <p className="mt-2 text-xs text-orange-600">Select an available time slot.</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Occasion">
            <Select value={occasion} onChange={(e) => setOccasion(e.target.value)} options={OCCASIONS} placeholder="None" />
          </Field>
        </div>
        <Field label="Special instructions">
          <Textarea value={requests} onChange={(e) => setRequests(e.target.value)} />
        </Field>
        <p className="text-xs text-ink-500">Changing the date, time or party size may require the restaurant to re-confirm your booking.</p>
      </div>
    </Modal>
  );
}
