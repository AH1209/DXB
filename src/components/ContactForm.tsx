import { useState } from 'react';
import ct from 'countries-and-timezones';
import { Camera, Check } from 'lucide-react';
import { api } from '../api';
import { countries, contactSchema, type Contact } from '../domain';
import { Sheet } from './UI';
export function ContactForm({
  contact,
  contacts,
  onClose,
  onSaved,
}: {
  contact?: Contact;
  contacts: Contact[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(contact?.name || '');
  const [country, setCountry] = useState(contact?.country || '');
  const [query, setQuery] = useState('');
  const [city, setCity] = useState(contact?.city || '');
  const [zone, setZone] = useState(contact?.timezone || '');
  const [age, setAge] = useState(contact?.age?.toString() || '');
  const [description, setDescription] = useState(contact?.description || '');
  const [enabled, setEnabled] = useState(contact?.enabled ?? true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState(contact?.id);
  const countryZones = country ? ct.getCountry(country)?.timezones || [] : [];
  const zones = [...new Set([...countryZones, ...Intl.supportedValuesOf('timeZone')])];
  async function save() {
    setError('');
    setBusy(true);
    try {
      const data = contactSchema.parse({
        name,
        country,
        city,
        timezone: zone,
        age: age ? Number(age) : null,
        description,
        enabled,
      });
      const result = await api<{ id: string }>(
        `contacts${savedId ? '/' + savedId : ''}`,
        savedId ? 'PUT' : 'POST',
        data,
      );
      setSavedId(result.id);
      if (photo) {
        const image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(photo);
        });
        await api(`avatars/${result.id}`, 'PUT', { image });
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save contact');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={contact ? 'Edit contact' : 'New contact'} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="photo-picker">
          <Camera size={25} />
          <span>
            {photo ? photo.name : 'Add a photo'}
            <small>PNG, JPEG or WebP · up to 2 MB</small>
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && file.size > 2097152) setError('Choose a photo under 2 MB');
              else setPhoto(file || null);
            }}
          />
        </label>
        <label>
          Name
          <input
            required
            maxLength={80}
            value={name}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
          />
        </label>
        {contacts.some(
          (c) => c.id !== savedId && c.name.toLowerCase() === name.trim().toLowerCase(),
        ) && (
          <small className="muted">
            A contact has this name. City and photo can help you tell them apart.
          </small>
        )}
        <label>
          Find a country
          <input
            type="search"
            placeholder="Search countries"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Country
          <select
            aria-label="Country"
            required
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setZone(ct.getCountry(e.target.value)?.timezones[0] || '');
            }}
          >
            <option value="">Choose a country</option>
            {countries
              .filter((c) => c.id === country || c.name.toLowerCase().includes(query.toLowerCase()))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          City or region
          <input
            value={city}
            maxLength={100}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label>
          Local time zone
          <select
            aria-label="Local time zone"
            required
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            <option value="">Choose a time zone</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        {countryZones.length > 1 && (
          <small className="muted">
            This country has multiple time zones. The suggested zone may differ from your contact’s
            city.
          </small>
        )}
        <div className="form-pair">
          <label>
            Age
            <input
              type="number"
              min={1}
              max={120}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Allow notifications
          </label>
        </div>
        <label>
          Description
          <textarea
            maxLength={300}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short note, just for you"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          <Check size={18} />
          {busy ? 'Saving…' : 'Save contact'}
        </button>
      </form>
    </Sheet>
  );
}
