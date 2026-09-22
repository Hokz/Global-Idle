'use client';

/**
 * The System UI — the third surface (Phase 3 spec §18).
 *
 * The Atlas is navigation and the Game Window is watching. This one MANAGES:
 * what is worn, what is carried, what a slot costs, what the filter lets
 * through, and what a counter will trade.
 *
 * It decides nothing. Every action is a request, the response is the whole
 * world again, and an invalid drop is refused BY THE SERVER and explained
 * here. Touch has no hover to depend on, so every action is reachable by tap:
 * select a thing, then choose what to do with it.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type InventoryView, type ItemView } from '../_lib/api';

const oz = (hundredths: number): string => (hundredths / 100).toFixed(2);

function Item({
  item,
  selected,
  onSelect,
}: {
  item: ItemView;
  selected: boolean;
  onSelect: (item: ItemView) => void;
}) {
  return (
    <button
      type="button"
      data-testid="item"
      data-item-id={item.id}
      data-definition={item.definitionKey}
      data-quantity={item.quantity}
      data-rarity={item.rarity}
      aria-pressed={selected}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', item.id);
        onSelect(item);
      }}
      onClick={() => onSelect(item)}
      className={`item ${selected ? 'item--selected' : ''}`}
    >
      <span className="item__label">{item.label}</span>
      {item.quantity > 1 ? <span className="item__count">×{item.quantity}</span> : null}
      {item.rarity !== 'COMMON' ? <span className="item__rarity">{item.rarity}</span> : null}
    </button>
  );
}

export function SystemWindow({ characterId }: { characterId: string }) {
  const [view, setView] = useState<InventoryView | null>(null);
  const [selected, setSelected] = useState<ItemView | null>(null);
  const [amount, setAmount] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setView(await api<InventoryView>(`/api/characters/${characterId}/inventory`));
  }, [characterId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every action is the same shape: ask, take the whole world back, or show
   *  exactly why the server said no. */
  const act = useCallback(
    async (path: string, body?: unknown) => {
      setBusy(true);
      setMessage(null);
      try {
        const next = await api<InventoryView>(`/api/characters/${characterId}${path}`, {
          method: 'POST',
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        setView(next);
        setSelected(null);
      } catch (error) {
        setMessage(
          error instanceof ApiError ? `${error.code}: ${error.message}` : 'Something went wrong.',
        );
      } finally {
        setBusy(false);
      }
    },
    [characterId],
  );

  const moveTo = useCallback(
    (to: { kind: string; slot?: string; containerId?: string }, id?: string) => {
      const instanceId = id ?? selected?.id;
      if (!instanceId) return;
      return act('/items/move', {
        instanceId,
        ...(amount > 0 && amount < (selected?.quantity ?? 1) ? { quantity: amount } : {}),
        to,
      });
    },
    [act, amount, selected],
  );

  if (!view) {
    return (
      <main data-testid="system-window" aria-busy="true">
        <p>Loading…</p>
      </main>
    );
  }

  const full = view.capacity.carried >= view.capacity.limit;

  return (
    <main data-testid="system-window" className="system">
      <header className="system__header">
        <h1>Manage</h1>
        <p
          data-testid="capacity"
          data-carried={view.capacity.carried}
          data-limit={view.capacity.limit}
        >
          Capacity <strong>{oz(view.capacity.carried)}</strong> / {oz(view.capacity.limit)} oz
          {full ? ' — full' : ''}
        </p>
        <p data-testid="gold">
          <span data-testid="gold-pouch">Gold Pouch {view.gold.pouch}</span>
          {' · '}
          <span data-testid="gold-bank">Bank {view.gold.bank}</span>
        </p>
        {view.inHunt ? (
          <p data-testid="in-hunt-notice">
            This Character is in a Hunt. The Depot, the Stash and the counter are not reachable from
            here.
          </p>
        ) : null}
      </header>

      {message ? (
        <p role="alert" data-testid="system-error">
          {message}
        </p>
      ) : null}

      <section data-testid="equipment">
        <h2>Worn</h2>
        <ul>
          {view.equipment.map((item) => (
            <li key={item.id} data-testid="equipment-slot" data-slot={item.slot}>
              <Item item={item} selected={selected?.id === item.id} onSelect={setSelected} />
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="slots">
        <h2>Hunt containers</h2>
        {view.slots.map((slot) => (
          <div
            key={slot.slotIndex}
            data-testid="container-slot"
            data-slot-index={slot.slotIndex}
            data-unlocked={slot.unlocked}
            onDragOver={(event) => {
              if (slot.containerInstanceId) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData('text/plain');
              if (slot.containerInstanceId) {
                void moveTo({ kind: 'CONTAINER', containerId: slot.containerInstanceId }, id);
              }
            }}
          >
            <h3>
              Slot {slot.slotIndex}
              {slot.unlocked ? '' : ` — locked (${slot.price} gold)`}
            </h3>
            {slot.unlocked ? (
              <>
                <p data-testid="slot-spaces">
                  {slot.contents.length} / {slot.spaces}
                </p>
                <ul>
                  {slot.contents.map((item) => (
                    <li key={item.id}>
                      <Item
                        item={item}
                        selected={selected?.id === item.id}
                        onSelect={setSelected}
                      />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <button
                type="button"
                data-testid="unlock-slot"
                disabled={busy}
                onClick={() => void act(`/slots/${slot.slotIndex}/unlock`)}
              >
                Unlock for {slot.price} gold
              </button>
            )}
          </div>
        ))}
      </section>

      <section data-testid="loot-pouch">
        <h2>Loot Pouch</h2>
        <p data-testid="pouch-occupancy">
          {view.lootPouch.contents.length} / {view.lootPouch.spaces}
        </p>
        <ul>
          {view.lootPouch.contents.map((item) => (
            <li key={item.id}>
              <Item item={item} selected={selected?.id === item.id} onSelect={setSelected} />
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="loot-filter">
        <h2>Loot filter</h2>
        <p data-testid="policy-mode">{view.lootPolicy.mode}</p>
        <button
          type="button"
          data-testid="toggle-policy"
          disabled={busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              try {
                setView(
                  await api<InventoryView>(`/api/characters/${characterId}/loot-policy`, {
                    method: 'PUT',
                    body: JSON.stringify({
                      mode:
                        view.lootPolicy.mode === 'ACCEPTED_ONLY'
                          ? 'COLLECT_ALL_EXCEPT_SKIPPED'
                          : 'ACCEPTED_ONLY',
                      rules: [],
                    }),
                  }),
                );
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          {view.lootPolicy.mode === 'ACCEPTED_ONLY' ? 'Collect everything' : 'Collect nothing'}
        </button>
      </section>

      <section data-testid="depot">
        <h2>Depot</h2>
        {view.inHunt ? (
          <p data-testid="depot-unavailable">Not reachable from a Hunt.</p>
        ) : (
          <ul>
            {view.depot.map((item) => (
              <li key={item.id}>
                <Item item={item} selected={selected?.id === item.id} onSelect={setSelected} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="stash">
        <h2>Stash</h2>
        {view.inHunt ? (
          <p data-testid="stash-unavailable">Not reachable from a Hunt.</p>
        ) : (
          <ul>
            {view.stash.map((entry) => (
              <li key={entry.definitionKey} data-testid="stash-entry">
                {entry.label} ×{entry.quantity}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="counter">
        <h2>Trading post</h2>
        {view.inHunt ? (
          <p data-testid="counter-unavailable">Not reachable from a Hunt.</p>
        ) : (
          <>
            {view.service.sells.map((entry) => (
              <button
                key={entry.itemKey}
                type="button"
                data-testid="buy"
                data-definition={entry.itemKey}
                disabled={busy}
                onClick={() =>
                  void act('/service/buy', { definitionKey: entry.itemKey, quantity: amount })
                }
              >
                Buy {amount} × {entry.itemKey} ({entry.price} each)
              </button>
            ))}
            <button
              type="button"
              data-testid="sell"
              disabled={busy || !selected?.sellable}
              onClick={() => void act('/service/sell', { instanceId: selected?.id })}
            >
              Sell selected
            </button>
          </>
        )}
      </section>

      {/* TOUCH: every action reachable without a hover or a drag. */}
      <section data-testid="actions">
        <h2>Selected</h2>
        <p data-testid="selection">{selected ? selected.label : 'Nothing selected'}</p>
        <label>
          Amount
          <input
            type="number"
            data-testid="amount"
            min={1}
            value={amount}
            onChange={(event) => setAmount(Math.max(1, Number(event.target.value)))}
          />
        </label>
        <button
          type="button"
          data-testid="move-to-container"
          disabled={busy || !selected || !view.slots[0]?.containerInstanceId}
          onClick={() =>
            void moveTo({
              kind: 'CONTAINER',
              containerId: view.slots[0]!.containerInstanceId!,
            })
          }
        >
          Move to container
        </button>
        <button
          type="button"
          data-testid="move-to-depot"
          disabled={busy || !selected || view.inHunt}
          onClick={() => void moveTo({ kind: 'DEPOT' })}
        >
          Move to Depot
        </button>
        <button
          type="button"
          data-testid="equip"
          disabled={busy || !selected || selected.location === 'EQUIPPED'}
          onClick={() => void moveTo({ kind: 'EQUIPPED', slot: 'LEFT' })}
        >
          Equip in hand
        </button>
        <button
          type="button"
          data-testid="deposit-gold"
          disabled={busy || view.inHunt || view.gold.pouch === '0'}
          onClick={() => void act('/gold/deposit', { amount: view.gold.pouch })}
        >
          Deposit all gold
        </button>
      </section>
    </main>
  );
}
