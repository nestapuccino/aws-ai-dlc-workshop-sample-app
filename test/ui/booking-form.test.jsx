import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { api, BookingForm } from '../../ui/App.jsx';

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function getField(container, testid) {
  return container.querySelector(`[data-testid="${testid}"]`);
}

async function submitForm(container) {
  const form = getField(container, 'booking-form');
  await act(async () => {
    form.requestSubmit();
    await flushPromises();
  });
}

function renderForm({ onBooked = vi.fn() } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const room = { id: 'cedar', name: 'Cedar', capacity: 4 };
  act(() => {
    root.render(<BookingForm room={room} date="2030-06-12" onBooked={onBooked} />);
  });
  return { container, root, onBooked };
}

describe('api()', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  test('resolves with the parsed response body on a 2xx response', async () => {
    global.fetch.mockResolvedValue(jsonResponse(201, { id: 'b1' }));
    await expect(api('/bookings', { method: 'POST' })).resolves.toEqual({ id: 'b1' });
  });

  test('throws an Error carrying the server message and HTTP status for a non-2xx response', async () => {
    global.fetch.mockResolvedValue(jsonResponse(400, { error: 'End time must be after start time.' }));
    await expect(api('/bookings', { method: 'POST' })).rejects.toMatchObject({
      message: 'End time must be after start time.',
      status: 400,
    });
  });

  test('attaches status 409 to the thrown error for a booking conflict response', async () => {
    global.fetch.mockResolvedValue(jsonResponse(409, {
      error: '"Design review" runs 09:00–10:00, booked by Sam Rivera.',
    }));
    await expect(api('/bookings', { method: 'POST' })).rejects.toMatchObject({
      message: '"Design review" runs 09:00–10:00, booked by Sam Rivera.',
      status: 409,
    });
  });

  test('falls back to a generic message when the error body carries none', async () => {
    global.fetch.mockResolvedValue(jsonResponse(500, {}));
    await expect(api('/bookings')).rejects.toMatchObject({
      message: 'Unable to complete the request.',
      status: 500,
    });
  });
});

describe('BookingForm', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('on a successful booking, resets the form and notifies the parent (req-success-path-unchanged, req-frontend-success-reset)', async () => {
    const booking = {
      id: 'b1', roomId: 'cedar', title: 'Brainstorm', organizer: 'Alex',
      startTime: '2030-06-12T09:00:00.000Z', endTime: '2030-06-12T10:00:00.000Z',
    };
    global.fetch.mockResolvedValue(jsonResponse(201, booking));
    const onBooked = vi.fn();
    const { container } = renderForm({ onBooked });

    getField(container, 'booking-form-title-input').value = 'Brainstorm';
    getField(container, 'booking-form-organizer-input').value = 'Alex';

    await submitForm(container);

    expect(onBooked).toHaveBeenCalledWith(booking);
    expect(getField(container, 'booking-form-title-input').value).toBe('');
    expect(getField(container, 'booking-form-organizer-input').value).toBe('');
    expect(getField(container, 'booking-form-start-time-input').value).toBe('09:00');
    expect(getField(container, 'booking-form-end-time-input').value).toBe('10:00');
    expect(getField(container, 'booking-form-error')).toBeNull();
  });

  test('on a 409 conflict, preserves title/organizer, clears only the time fields, and shows the conflict message verbatim (req-frontend-form-retention, req-frontend-error-display, req-409-response-shape)', async () => {
    global.fetch.mockResolvedValue(jsonResponse(409, {
      error: '"Design review" runs 09:00–10:00, booked by Sam Rivera.',
    }));
    const onBooked = vi.fn();
    const { container } = renderForm({ onBooked });

    getField(container, 'booking-form-title-input').value = 'Brainstorm';
    getField(container, 'booking-form-organizer-input').value = 'Alex Morgan';
    getField(container, 'booking-form-start-time-input').value = '09:00';
    getField(container, 'booking-form-end-time-input').value = '10:00';

    await submitForm(container);

    expect(getField(container, 'booking-form-title-input').value).toBe('Brainstorm');
    expect(getField(container, 'booking-form-organizer-input').value).toBe('Alex Morgan');
    expect(getField(container, 'booking-form-start-time-input').value).toBe('');
    expect(getField(container, 'booking-form-end-time-input').value).toBe('');
    expect(getField(container, 'booking-form-error').textContent).toBe(
      '"Design review" runs 09:00–10:00, booked by Sam Rivera.'
    );
    expect(onBooked).not.toHaveBeenCalled();
  });

  test("on a non-409 error, keeps today's behavior: shows the message but clears no field", async () => {
    global.fetch.mockResolvedValue(jsonResponse(400, { error: 'End time must be after start time.' }));
    const { container } = renderForm();

    getField(container, 'booking-form-title-input').value = 'Brainstorm';
    getField(container, 'booking-form-organizer-input').value = 'Alex Morgan';
    getField(container, 'booking-form-start-time-input').value = '09:00';
    getField(container, 'booking-form-end-time-input').value = '09:30';

    await submitForm(container);

    expect(getField(container, 'booking-form-title-input').value).toBe('Brainstorm');
    expect(getField(container, 'booking-form-organizer-input').value).toBe('Alex Morgan');
    expect(getField(container, 'booking-form-start-time-input').value).toBe('09:00');
    expect(getField(container, 'booking-form-end-time-input').value).toBe('09:30');
    expect(getField(container, 'booking-form-error').textContent).toBe('End time must be after start time.');
  });

  test('after a conflict, adjusting only the time and resubmitting succeeds without re-entering title/organizer (story-retry-after-conflict)', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(409, { error: 'Conflict message.' }));
    const onBooked = vi.fn();
    const { container } = renderForm({ onBooked });

    getField(container, 'booking-form-title-input').value = 'Brainstorm';
    getField(container, 'booking-form-organizer-input').value = 'Alex Morgan';
    await submitForm(container);
    expect(getField(container, 'booking-form-error')).not.toBeNull();

    getField(container, 'booking-form-start-time-input').value = '11:00';
    getField(container, 'booking-form-end-time-input').value = '11:30';
    const booking = {
      id: 'b2', roomId: 'cedar', title: 'Brainstorm', organizer: 'Alex Morgan',
      startTime: '2030-06-12T11:00:00.000Z', endTime: '2030-06-12T11:30:00.000Z',
    };
    global.fetch.mockResolvedValueOnce(jsonResponse(201, booking));

    await submitForm(container);

    expect(onBooked).toHaveBeenCalledWith(booking);
    expect(getField(container, 'booking-form-error')).toBeNull();
  });
});
