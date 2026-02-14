# 3D Window Viewer

A web application that lets you select a window on any building in the world using Google's Photorealistic 3D Tiles, then experience an immersive "inside looking out" view as if you were standing in a room behind that window.

**Note**: You must set up a **Google Maps Platform API Key** with the **Map Tiles API** enabled to use this. See [Setup](#obtaining-a-google-maps-api-key).

## Features

- **3D Earth Navigation**: Explore the entire world using Google's Photorealistic 3D Tiles
- **Window Selection**: Click on any building surface to define a "window"
- **Immersive View Mode**: Step inside and look out through your selected window
- **First-Person Controls**: WASD movement and mouse look for natural exploration
- **State Persistence**: Your window selection, camera position, and mode are saved in the URL hash
- **Virtual Room**: A procedurally generated room (floor, walls, ceiling) appears behind the window
- **Sun Path Visualization**: View the sun's annual trajectory with date and time labels directly in the sky

## Examples

NYC:
- 15 William Street, unit [#41I](https://the15william.com/unit-41I)

  https://wengh.github.io/window-view/#win=1333828.147,-4654719.573,4137757.221,0.554,0.636,0.537,-0.311,-0.367,-0.877,-0.011,3.500,2.200&mode=navigating&cam=1333871.887,-4654709.297,4137881.935,3.482,-0.659,0.000

  From this app:
  <img width="3740" height="2046" alt="image" src="https://github.com/user-attachments/assets/d5404149-8cde-4a53-8352-204cd732cc3a" />

  IRL:
  <img width="2014" height="1647" alt="image" src="https://github.com/user-attachments/assets/95b40de2-e564-4c2b-96b8-1dd36fe886cf" />

Chicago:
- Wolf Point East, unit [#4103](https://a.peek.us/viewer?token=EF_C6iJ1gK)

  https://wengh.github.io/window-view/#win=196103.197,-4751503.996,4236516.016,0.025,-0.665,-0.747,-0.934,-0.019,-0.006,-0.356,3.500,2.500&mode=viewing&cam=196103.311,-4751503.880,4236516.291,3.129,0.595,6.283,2.094&sp=1

  From this app:
  <img width="3744" height="2063" alt="image" src="https://github.com/user-attachments/assets/b7f44f8d-75f3-40aa-bf0f-eddb2e01474d" />

  IRL:
  <img width="2197" height="1865" alt="image" src="https://github.com/user-attachments/assets/9ef28cbf-560a-4200-b72f-00c6863d8e25" />

Waterloo:
- E5 bridge

  https://wengh.github.io/window-view/#win=762001.692,-4573191.063,4365935.320,-0.708,0.423,0.566,0.337,-0.321,-0.863,0.195,10.000,2.500&mode=viewing&cam=762004.916,-4573192.487,4365933.415,5.281,-0.038,6.283

  From this app:
  <img width="3743" height="2057" alt="image" src="https://github.com/user-attachments/assets/6f1e1a44-0fed-4e43-a1f3-3c2c8863dfc4" />

## Controls

### Navigation Mode (Default)
| Action | Control |
|--------|---------|
| Rotate view | Left-click + drag |
| Pan | Right-click + drag |
| Zoom | Scroll wheel |

### Selection Mode
| Action | Control |
|--------|---------|
| Select window | Left-click on a building surface |
| Adjust window size | Use the Width/Height sliders in the UI panel |

### First-Person View Mode
| Action | Control |
|--------|---------|
| Move forward | W |
| Move backward | S |
| Strafe left | A |
| Strafe right | D |
| Look around | Left-click + drag |
| Zoom (FOV) | Scroll wheel |
| Reset FOV | Middle-click |
| Toggle Sun Path | Click "Show Sun Path" button |

## Usage Workflow

1. **Navigate** to a building you're interested in
2. Click **"Enter Selection Mode"** in the control panel
3. **Click** on a wall surface to place a window
4. Adjust the **width** and **height** sliders to size the window
5. Click **"View from Inside"** to enter the immersive view
6. Use **WASD** and **mouse drag** to look around from inside the virtual room
7. Click **"Exit View"** to return to navigation mode

## URL State Persistence

The application automatically saves the following to the URL hash:
- Window selection (position, normal, size)
- Camera position and orientation (including Field of View)
- Current mode (navigating/selecting/viewing)
- Sun Path visibility state

You can bookmark or share URLs to return to the exact same view later.

## Technical Stack

- **React** + **TypeScript**
- **Vite** (build tool)
- **CesiumJS** + **Resium** (3D globe rendering)
- **Google Photorealistic 3D Tiles** (building/terrain data)

---

## Setup

### Requirements

- Node.js 18+ and npm
- A **Google Maps Platform API Key** with the **Map Tiles API** enabled
- Modern web browser with WebGL support

### Obtaining a Google Maps API Key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)

2. **Create a new project** (or select an existing one)
   - Click the project dropdown at the top of the page
   - Click "New Project"
   - Enter a project name and click "Create"

3. **Enable the Map Tiles API**
   - Go directly to the [Map Tiles API page](https://console.cloud.google.com/apis/library/tile.googleapis.com)
   - Or: In the left sidebar, go to **APIs & Services** → **Library** and search for "Map Tiles API"
   - Click **"Enable"**

   > **Important**: You need the "Map Tiles API", not the "Maps JavaScript API". The Map Tiles API provides access to the Photorealistic 3D Tiles.

4. **Create an API Key**
   - Go to **APIs & Services** → **Credentials**
   - Click **"+ Create Credentials"** → **"API Key"**
   - Your new API key will be displayed - copy it

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/wengh/window-view.git
   cd window-view
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API Key** (choose one method):

   - **Option A: Environment Variable**
     Create a `.env` file in the project root:
     ```
     VITE_GOOGLE_MAPS_API_KEY=your_api_key_here
     ```

   - **Option B: Runtime Entry**
     The app will prompt you for the API key on first load. It's saved locally to your browser's `localStorage` for future sessions and is never transmitted to any third-party server.

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open** `http://localhost:5173` in your browser
