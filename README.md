# Window View

**See the view from any window in the world — before you ever visit.**

Apartment hunting? Curious about a listing's natural light or skyline view? Window View lets you click on any building on a 3D globe, pick a window, and step inside a virtual room to see exactly what you'd see looking out — all from your browser.

> **Try it now:** [wengh.github.io/window-view](https://wengh.github.io/window-view)

---

## Why This Exists

Listing photos can be misleading. "City views" might mean a sliver of sky between two buildings, and "sun-drenched" might only apply for 20 minutes a day. Window View solves this by letting you:

- 🏙️ **Preview the view** from any unit, any floor, any direction — before scheduling a tour.
- ☀️ **Check the sunlight** using the built-in sun path overlay, which shows you exactly when and where the sun will be visible from a given window throughout the year.
- 🔗 **Save & share views** — every window selection is encoded in the URL, so you can bookmark favorites or send them to a friend.

---

## Examples

### New York — 15 William Street, unit [#41I](https://the15william.com/unit-41I)

[**→ Open in Window View**](https://wengh.github.io/window-view/#win=1333828.147,-4654719.573,4137757.221,0.554,0.636,0.537,-0.311,-0.367,-0.877,-0.011,3.500,2.200&mode=navigating&cam=1333871.887,-4654709.297,4137881.935,3.482,-0.659,0.000)

|                                                                                                 Window View                                                                                                 |                                                                                                           Real Life                                                                                                           |
| :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| <img width="600" alt="Simulated view from 15 William Street, NYC, showing neighbor skyscrapers and clear blue sky" src="https://github.com/user-attachments/assets/a0aa1022-0f62-407a-86e0-d3a7c40fbd80" /> | <img width="600" alt="Real photo view from 15 William Street, NYC, illustrating the accuracy of the building assets and perspective" src="https://github.com/user-attachments/assets/95b40de2-e564-4c2b-96b8-1dd36fe886cf" /> |

### Chicago — Wolf Point East, unit [#4103](https://a.peek.us/viewer?token=EF_C6iJ1gK)

[**→ Open in Window View**](https://wengh.github.io/window-view/#win=196103.197,-4751503.996,4236516.016,0.025,-0.665,-0.747,-0.934,-0.019,-0.006,-0.356,3.500,2.500&mode=viewing&cam=196103.311,-4751503.880,4236516.291,3.129,0.595,6.283,2.094&sp=1)

|                                                                                                       Window View (+ sun path)                                                                                                        |                                                                                                          Real Life                                                                                                           |
| :-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| <img width="600" alt="Simulated view from Wolf Point East, Chicago, with Sun Path overlay displaying hourly sun positions and seasonal arcs" src="https://github.com/user-attachments/assets/b7f44f8d-75f3-40aa-bf0f-eddb2e01474d" /> | <img width="600" alt="Real interior view from Wolf Point East, Chicago, overlooking the river and cityscape through a large window" src="https://github.com/user-attachments/assets/9ef28cbf-560a-4200-b72f-00c6863d8e25" /> |

### Waterloo — E5 Bridge

[**→ Open in Window View**](https://wengh.github.io/window-view/#win=762001.692,-4573191.063,4365935.320,-0.708,0.423,0.566,0.337,-0.321,-0.863,0.195,10.000,2.500&mode=viewing&cam=762004.048,-4573190.589,4365935.554,5.464,-0.075,6.283,1.994)

<img width="600" alt="Simulated view from E5 bridge, Waterloo, depicting railway tracks and surrounding vegetation" src="https://github.com/user-attachments/assets/b867b544-f94c-4a0c-bd15-d0ceac34b064" />

### Sun path

<img width="1230" height="2015" alt="Detailed sun path overlay showing hourly analemmas (figure-8 loops) indicating the sun's position throughout the year, with date labels for solstices and equinoxes" src="https://github.com/user-attachments/assets/12c8d14d-b837-46d2-aea0-eb165fbf8c14" />

---

## How to Use

1. **Navigate** the 3D globe to find the building you're interested in.
2. Click **"Enter Selection Mode"** in the control panel.
3. **Click on a wall** to place a window where you want it.
4. Adjust the **width** and **height** sliders to match the window size.
5. Click **"View from Inside"** to step into the room and look out.
6. Use **WASD** to move around and **click-drag** to look in any direction.
7. Toggle **"Show Sun Path"** to visualize sunlight throughout the year.

### Controls Reference

#### Globe Navigation (default)

| Action      | Control            |
| ----------- | ------------------ |
| Pan view    | Left click + drag  |
| Zoom view   | Mouse wheel scroll |
| Rotate view | Right click + drag |

#### Selecting a Window

| Action        | Control                           |
| ------------- | --------------------------------- |
| Place window  | Left-click on a building surface  |
| Resize window | Width/Height sliders in the panel |

#### Inside View (first-person)

| Action      | Control                      |
| ----------- | ---------------------------- |
| Move        | W A S D                      |
| Look around | Left-click + drag            |
| Zoom (FOV)  | Scroll wheel                 |
| Reset zoom  | Middle-click                 |
| Sun path    | Click "Show Sun Path" button |

---

## Sharing & Bookmarking

Everything about your current view — the window you selected, your camera angle, and whether the sun path is visible — is automatically saved in the URL. Just copy the address bar to:

- 📌 **Bookmark** your favorite apartments
- 📤 **Share** a specific view with your partner, roommate, or broker
- 🔁 **Come back later** and pick up exactly where you left off

---

## Running Locally

### Getting a Cesium Ion Token

Window View uses Cesium Ion to stream 3D tiles. If you are running this locally, you will need a free Cesium Ion account and access token.

1.  Sign up for a free account at [cesium.com/ion](https://ion.cesium.com/).
2.  Go to the **Access Tokens** tab.
3.  Create a new token (or use the default one).
4.  Make sure the token has access to the [**Google Photorealistic 3D Tiles**](https://ion.cesium.com/assetdepot/2275207) asset. This should be granted by default.

Then create a `.env` file at project root with your API key:

```
VITE_CESIUM_ION_TOKEN=your_token_here
```

### Running the App

```bash
git clone https://github.com/wengh/window-view.git
cd window-view
npm install
npm run dev
```

Then open `http://localhost:5173`.
