/**
 * PitStopManager.ts - Ultra-Realistic Professional F1 / WEC 3D Pit Stop System
 * 
 * Hyper-Realistic Features:
 * 1. Full 14-Member Coordinated F1 Crew:
 *    - 4 Dedicated Wheel Gunners with Analytical Two-Bone IK and Paoli DP 6000 pneumatic impact wrenches.
 *    - 4 Tyre-Off Mechanics who physically dismount and carry away the used, worn race slicks.
 *    - 4 Tyre-On Mechanics who lift brand new Pirelli soft slicks from thermal stands and slide them flush onto the spindle.
 *    - Front & Rear Quick-Release Trolley Jack Operators with mechanical lever kinematics.
 *    - Front Wing Aero Tech & Radiator Cooling Specialist.
 *    - Chief Pit Controller (Lollipop Marshal) with animated digital Red/Green signal.
 * 2. True Mechanical 4-Wheel Physical Exchange:
 *    - Old worn tires detach physically from the spindle, exposing the bare ventilated carbon ceramic discs & Brembo calipers!
 *    - Dismounted tires are pulled outward into the hands of the Tyre-Off crew.
 *    - Brand new, glossy Pirelli P-Zero soft slicks arc gracefully in 3D Bézier trajectories from their tire blankets onto the axle hubs!
 *    - Monolug centerlock nuts tightened with 3000 Nm high-torque rattle, golden friction sparks, and nitrogen exhaust bursts.
 * 3. Gravity Freefall & Suspension Slam Dynamics:
 *    - Hydraulic jacks dump pressure: 1180 kg prototype drops under gravitational acceleration.
 *    - Hard suspension bump & damped dual-cycle rebound squat upon tarmac contact.
 *    - Heavy mechanical chassis thud audio and camera shock.
 * 4. Realistic F1 Team Radio & Digital Pit Gantry Timing Screen.
 */

import * as THREE from 'three';
import { EngineSound } from '../audio/EngineSound';
import { CarModel } from '../models/CarModel';
import { ParticleSystem } from '../particles/ParticleSystem';
import { VehiclePhysics } from '../physics/VehiclePhysics';
import { CrewModelImporter } from '../loaders/CrewModelImporter';
import { TIRE_COMPOUNDS, TireCompoundType } from '../physics/TireCompound';

export type PitStopPhase = 'none' | 'entry_autopilot' | 'docking' | 'jacks_up' | 'servicing' | 'jacks_down' | 'released';

export interface ArmIKJoints {
  shoulder: THREE.Group;
  upperArm: THREE.Mesh;
  elbow: THREE.Group;
  forearm: THREE.Mesh;
  hand: THREE.Group;
  l1: number;
  l2: number;
  isRight: boolean;
}

export type CrewRoleType =
  | 'front_jack'
  | 'rear_jack'
  | 'gunner_fl' | 'gunner_fr' | 'gunner_rl' | 'gunner_rr'
  | 'tyre_off_fl' | 'tyre_off_fr' | 'tyre_off_rl' | 'tyre_off_rr'
  | 'tyre_on_fl' | 'tyre_on_fr' | 'tyre_on_rl' | 'tyre_on_rr'
  | 'wing_tech'
  | 'radiator_tech'
  | 'lollipop';

export interface PitCrewMember {
  group: THREE.Group;
  proceduralBody: THREE.Group;
  customBody?: THREE.Group;
  basePos: THREE.Vector3;
  baseRotY: number;
  standbyPos: THREE.Vector3;
  servicePos: THREE.Vector3;
  exitPos: THREE.Vector3;
  type: CrewRoleType;
  toolMesh?: THREE.Object3D;
  leftArmIK?: ArmIKJoints;
  rightArmIK?: ArmIKJoints;
  wheelIndex?: number;
}

export class PitStopManager {
  public group: THREE.Group;
  private crewMembers: PitCrewMember[] = [];

  // Custom User-Uploaded 3D Pit Crew Mechanics State
  public isCustomCrew: boolean = false;
  public currentCrewName: string = 'Pit Crew Apex Scuderia';
  private customCrewProto: THREE.Group | null = null;

  // Real 3D Wheel Props: Fresh New Slicks & Dismounted Used Tires
  private spareWheels: THREE.Group[] = [];        // Fresh Pirelli Soft Slicks on thermal stands
  private dismountedWheels: THREE.Group[] = [];   // Used worn tires pulled off the car
  private freshPzeroStripeMat!: THREE.MeshStandardMaterial;
  private dismountedPzeroStripeMat!: THREE.MeshStandardMaterial;

  // Holographic diagnostic CAD laser scanner
  private scannerGroup!: THREE.Group;
  private laserBeamMesh!: THREE.Mesh;
  private laserCurtainMesh!: THREE.Mesh;
  private holographicGridMesh!: THREE.Mesh;

  // Overhead air tool boom & hanging coiled hoses
  private airBoomsGroup!: THREE.Group;
  private airHoses: THREE.Mesh[] = [];

  // Digital Pit Wall Timing Screen
  private pitWallDisplayCanvas!: HTMLCanvasElement;
  private pitWallDisplayTex!: THREE.CanvasTexture;
  private pitWallDisplayMesh!: THREE.Mesh;

  // Active Lollipop sign
  private lollipopSignGroup!: THREE.Group;
  private lollipopDiscMat!: THREE.MeshStandardMaterial;

  // Pit Box Geometry (Centered at x = 0, z = -116)
  public readonly pitCenter = new THREE.Vector3(0, 0.35, -116);
  public readonly pitBounds = {
    minX: -16,
    maxX: 16,
    minZ: -120.5,
    maxZ: -111.5,
  };

  // Strategy: Next tire compound chosen for the pit stop
  public nextTireCompound: TireCompoundType = 'soft';

  // State Machine
  public phase: PitStopPhase = 'none';
  public totalDuration = 0;
  public elapsedTime = 0;
  public repairProgress = 0;
  public initialDamageFraction = 0;
  public carElevatedY = 0;

  // F1 Team Radio & TV Broadcast Metadata
  public radioMessage: string | null = null;
  public broadcastCamName: string | null = null;

  // Auto-docking interpolation state
  private dockStartPos = { x: 0, z: 0, yaw: 0 };
  private dockDuration = 0.8;

  // Cooldown to prevent repeating pit stops while exiting
  public cooldownTimer = 0;

  // Audio & effects single-shot triggers
  private lastGunSoundTime = 0;
  private lastSparkTime = 0;
  private lastAirBurstTime = 0;
  private hasTriggeredJackUpSound = false;
  private hasTriggeredJackDownSound = false;
  private hasTriggeredChime = false;
  private hasTriggeredRadioEntry = false;
  private hasTriggeredRadioTyres = false;
  private hasTriggeredRadioExit = false;

  constructor() {
    this.group = new THREE.Group();
    this.buildPitStallEnvironment();
    this.buildPitCrew();
    this.buildPhysicalWheelProps();
    this.buildDiagnosticLaser();
    this.buildAirBooms();
  }

  /**
   * Build the physical pit stall markings and digital timing board
   */
  private buildPitStallEnvironment(): void {
    const stallGroup = new THREE.Group();

    // High-grip Pit Stall Concrete Pad with team boundary lines
    const padGeo = new THREE.PlaneGeometry(36, 9.0);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.65,
      metalness: 0.1,
    });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.position.set(0, 0.008, -116);
    padMesh.receiveShadow = true;
    stallGroup.add(padMesh);

    // Pit Box Target Apron (Red and Yellow high-contrast hazard stripes)
    const boxGeo = new THREE.PlaneGeometry(9.0, 4.6);
    boxGeo.rotateX(-Math.PI / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#facc15';
    for (let x = -128; x < 384; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 24, 0);
      ctx.lineTo(x - 24 + 128, 128);
      ctx.lineTo(x - 48 + 128, 128);
      ctx.closePath();
      ctx.fill();
    }
    // Team Logo Text on Pit Stall
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('APEX RACING · BOX 01', 128, 70);

    const boxTex = new THREE.CanvasTexture(canvas);
    const boxMat = new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.5 });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    boxMesh.position.set(0, 0.012, -116);
    stallGroup.add(boxMesh);

    // Digital Pit Wall Display Board
    this.pitWallDisplayCanvas = document.createElement('canvas');
    this.pitWallDisplayCanvas.width = 256;
    this.pitWallDisplayCanvas.height = 128;
    this.pitWallDisplayTex = new THREE.CanvasTexture(this.pitWallDisplayCanvas);

    const displayGeo = new THREE.BoxGeometry(3.6, 1.8, 0.2);
    const displayMat = new THREE.MeshBasicMaterial({ map: this.pitWallDisplayTex });
    this.pitWallDisplayMesh = new THREE.Mesh(displayGeo, displayMat);
    this.pitWallDisplayMesh.position.set(0, 2.6, -111.4);
    stallGroup.add(this.pitWallDisplayMesh);

    this.group.add(stallGroup);
  }

  /**
   * Build realistic 3D Pit Crew Mechanics with articulated Two-Bone IK skeletal arms
   */
  private buildPitCrew(): void {
    const suitMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626, // Team Rosso Corsa racing fire suit
      roughness: 0.6,
      metalness: 0.1,
    });
    const suitBlackMat = new THREE.MeshStandardMaterial({
      color: 0x18181b, // Carbon black contrast panels
      roughness: 0.5,
    });
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      metalness: 0.4,
      roughness: 0.2,
    });
    const visorMat = new THREE.MeshPhysicalMaterial({
      color: 0x050505,
      metalness: 0.95,
      roughness: 0.05,
      clearcoat: 1.0,
    });
    const toolMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.85,
      roughness: 0.2,
    });

    const createHumanCrewMember = (
      type: CrewRoleType,
      standbyPos: THREE.Vector3,
      servicePos: THREE.Vector3,
      exitPos: THREE.Vector3,
      rotationY: number,
      wheelIndex?: number,
      hasTwoBoneIK: boolean = false
    ): PitCrewMember => {
      const memberGroup = new THREE.Group();
      memberGroup.position.copy(standbyPos);
      memberGroup.rotation.y = rotationY;

      const proceduralBody = new THREE.Group();
      proceduralBody.name = `ProceduralMechanic_${type}`;
      memberGroup.add(proceduralBody);

      // 1. Legs & Racing Boots
      [-0.14, 0.14].forEach((legX) => {
        const legGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.72, 8);
        const leg = new THREE.Mesh(legGeo, suitBlackMat);
        leg.position.set(legX, 0.36, 0);
        leg.castShadow = true;
        proceduralBody.add(leg);

        const bootGeo = new THREE.BoxGeometry(0.16, 0.12, 0.26);
        const boot = new THREE.Mesh(bootGeo, suitBlackMat);
        boot.position.set(legX, 0.06, 0.05);
        proceduralBody.add(boot);
      });

      // 2. Torso with fireproof racing overalls
      const torsoGeo = new THREE.BoxGeometry(0.44, 0.58, 0.26);
      const torso = new THREE.Mesh(torsoGeo, suitMat);
      torso.position.set(0, 0.95, 0);
      torso.castShadow = true;
      proceduralBody.add(torso);

      // Sponsor Team Stripe across chest
      const stripeGeo = new THREE.BoxGeometry(0.45, 0.12, 0.27);
      const stripe = new THREE.Mesh(stripeGeo, suitBlackMat);
      stripe.position.set(0, 1.02, 0);
      proceduralBody.add(stripe);

      // 3. Head & Racing Helmet
      const neckGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8);
      const neck = new THREE.Mesh(neckGeo, suitBlackMat);
      neck.position.set(0, 1.28, 0);
      proceduralBody.add(neck);

      const helmetGeo = new THREE.SphereGeometry(0.16, 14, 12);
      helmetGeo.scale(0.9, 1.05, 1.0);
      const helmet = new THREE.Mesh(helmetGeo, helmetMat);
      helmet.position.set(0, 1.42, 0);
      helmet.castShadow = true;
      proceduralBody.add(helmet);

      // Dark Tinted Full-Face Visor
      const visorGeo = new THREE.BoxGeometry(0.18, 0.08, 0.12);
      const visor = new THREE.Mesh(visorGeo, visorMat);
      visor.position.set(0, 1.42, 0.11);
      proceduralBody.add(visor);

      // 4. Arms
      let leftArmIK: ArmIKJoints | undefined;
      let rightArmIK: ArmIKJoints | undefined;
      let toolMesh: THREE.Object3D | undefined;

      if (hasTwoBoneIK) {
        // TWO-BONE ANALYTICAL IK SKELETON:
        // Shoulder -> Upper Arm (L1 = 0.28m) -> Elbow -> Forearm (L2 = 0.26m) -> Hand Tool
        const createArmIK = (isRight: boolean): ArmIKJoints => {
          const l1 = 0.28;
          const l2 = 0.26;
          const sx = isRight ? 0.24 : -0.24;

          const shoulderGroup = new THREE.Group();
          shoulderGroup.position.set(sx, 1.12, 0.04);

          const upperGeo = new THREE.CylinderGeometry(0.055, 0.05, l1, 8);
          upperGeo.translate(0, -l1 / 2, 0);
          const upperArm = new THREE.Mesh(upperGeo, suitMat);
          shoulderGroup.add(upperArm);

          const elbowGroup = new THREE.Group();
          elbowGroup.position.set(0, -l1, 0);

          const elbowCapGeo = new THREE.SphereGeometry(0.052, 8, 8);
          const elbowCap = new THREE.Mesh(elbowCapGeo, suitBlackMat);
          elbowGroup.add(elbowCap);

          const foreGeo = new THREE.CylinderGeometry(0.048, 0.044, l2, 8);
          foreGeo.translate(0, -l2 / 2, 0);
          const forearm = new THREE.Mesh(foreGeo, suitMat);
          elbowGroup.add(forearm);

          const handGroup = new THREE.Group();
          handGroup.position.set(0, -l2, 0);
          const gloveGeo = new THREE.SphereGeometry(0.05, 8, 8);
          const glove = new THREE.Mesh(gloveGeo, suitBlackMat);
          handGroup.add(glove);

          elbowGroup.add(handGroup);
          shoulderGroup.add(elbowGroup);
          proceduralBody.add(shoulderGroup);

          return {
            shoulder: shoulderGroup,
            upperArm,
            elbow: elbowGroup,
            forearm,
            hand: handGroup,
            l1,
            l2,
            isRight,
          };
        };

        leftArmIK = createArmIK(false);
        rightArmIK = createArmIK(true);

        if (type.startsWith('gunner_')) {
          // Paoli DP 6000 High-Torque Pneumatic Wheel Gun
          const gunGroup = new THREE.Group();
          const gunBodyGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.26, 12);
          gunBodyGeo.rotateX(Math.PI / 2);
          const gunBody = new THREE.Mesh(gunBodyGeo, toolMat);
          gunGroup.add(gunBody);

          const socketGeo = new THREE.CylinderGeometry(0.038, 0.042, 0.12, 10);
          socketGeo.rotateX(Math.PI / 2);
          const socket = new THREE.Mesh(socketGeo, new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.95 }));
          socket.position.set(0, 0, 0.18);
          gunGroup.add(socket);

          const handleGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.18, 8);
          const handle = new THREE.Mesh(handleGeo, suitBlackMat);
          handle.position.set(0, -0.14, -0.04);
          gunGroup.add(handle);

          rightArmIK.hand.add(gunGroup);
          toolMesh = gunGroup;
        }
      } else {
        // Standard static arms for other roles
        [-0.24, 0.24].forEach((armX) => {
          const armGeo = new THREE.CylinderGeometry(0.055, 0.048, 0.52, 8);
          const arm = new THREE.Mesh(armGeo, suitMat);
          arm.position.set(armX, 0.94, 0.08);
          arm.rotation.x = -0.35;
          proceduralBody.add(arm);
        });

        if (type === 'front_jack') {
          const jackGroup = new THREE.Group();
          const frameGeo = new THREE.BoxGeometry(0.48, 0.08, 1.3);
          const frame = new THREE.Mesh(frameGeo, toolMat);
          frame.position.set(0, 0.1, 0.7);
          jackGroup.add(frame);

          const handleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8);
          handleGeo.rotateX(-0.6);
          const handle = new THREE.Mesh(handleGeo, suitMat);
          handle.position.set(0, 0.6, 0.2);
          jackGroup.add(handle);

          proceduralBody.add(jackGroup);
          toolMesh = jackGroup;
        } else if (type === 'rear_jack') {
          const jackGroup = new THREE.Group();
          const armGeo = new THREE.BoxGeometry(0.5, 0.08, 1.2);
          const arm = new THREE.Mesh(armGeo, toolMat);
          arm.position.set(0, 0.12, -0.6);
          jackGroup.add(arm);

          const leverGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.1, 8);
          leverGeo.rotateX(0.5);
          const lever = new THREE.Mesh(leverGeo, suitMat);
          lever.position.set(0, 0.55, -0.2);
          jackGroup.add(lever);

          proceduralBody.add(jackGroup);
          toolMesh = jackGroup;
        } else if (type === 'lollipop') {
          this.lollipopSignGroup = new THREE.Group();
          const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, 3.2, 8);
          const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
          const pole = new THREE.Mesh(poleGeo, poleMat);
          pole.position.set(0, 1.6, 0.8);
          pole.rotateX(0.2);
          this.lollipopSignGroup.add(pole);

          const discGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24);
          discGeo.rotateX(Math.PI / 2);
          this.lollipopDiscMat = new THREE.MeshStandardMaterial({
            color: 0xdc2626,
            emissive: 0xef4444,
            emissiveIntensity: 1.8,
            roughness: 0.3,
          });
          const disc = new THREE.Mesh(discGeo, this.lollipopDiscMat);
          disc.position.set(0, 2.5, 1.25);
          this.lollipopSignGroup.add(disc);

          proceduralBody.add(this.lollipopSignGroup);
          toolMesh = this.lollipopSignGroup;
        }
      }

      this.group.add(memberGroup);

      return {
        group: memberGroup,
        proceduralBody,
        basePos: standbyPos.clone(),
        baseRotY: rotationY,
        standbyPos,
        servicePos,
        exitPos,
        type,
        toolMesh,
        leftArmIK,
        rightArmIK,
        wheelIndex,
      };
    };

    // 1. FRONT JACK OPERATOR
    this.crewMembers.push(createHumanCrewMember(
      'front_jack',
      new THREE.Vector3(3.55, 0, -114.2),
      new THREE.Vector3(3.05, 0, -116.0),
      new THREE.Vector3(3.85, 0, -114.2),
      -Math.PI / 2
    ));

    // 2. REAR JACK OPERATOR
    this.crewMembers.push(createHumanCrewMember(
      'rear_jack',
      new THREE.Vector3(-3.55, 0, -114.2),
      new THREE.Vector3(-3.05, 0, -116.0),
      new THREE.Vector3(-3.85, 0, -114.2),
      Math.PI / 2
    ));

    // 3. DEDICATED F1 WHEEL CORNER CREWS (Collision-Free Spatial Layout with Full Two-Bone IK)
    // FRONT-LEFT (Wheel 0, hub at x = 1.25, z = -115.08, outward along +Z)
    this.crewMembers.push(createHumanCrewMember(
      'gunner_fl',
      new THREE.Vector3(1.25, 0, -113.75),
      new THREE.Vector3(1.25, 0, -113.75),
      new THREE.Vector3(1.25, 0, -112.5),
      Math.PI,
      0,
      true
    ));
    this.crewMembers.push(createHumanCrewMember(
      'tyre_off_fl',
      new THREE.Vector3(1.85, 0, -113.85),
      new THREE.Vector3(1.65, 0, -114.30),
      new THREE.Vector3(2.45, 0, -112.5),
      Math.PI * 0.88,
      0,
      true
    ));
    this.crewMembers.push(createHumanCrewMember(
      'tyre_on_fl',
      new THREE.Vector3(0.65, 0, -112.75),
      new THREE.Vector3(0.85, 0, -114.30),
      new THREE.Vector3(0.65, 0, -112.5),
      Math.PI * 1.12,
      0,
      true
    ));

    // FRONT-RIGHT (Wheel 1, hub at x = 1.25, z = -116.92, outward along -Z)
    this.crewMembers.push(createHumanCrewMember(
      'gunner_fr',
      new THREE.Vector3(1.25, 0, -118.25),
      new THREE.Vector3(1.25, 0, -118.25),
      new THREE.Vector3(1.25, 0, -119.5),
      0,
      1,
      true
    ));
    this.crewMembers.push(createHumanCrewMember(
      'tyre_off_fr',
      new THREE.Vector3(1.85, 0, -118.20),
      new THREE.Vector3(1.65, 0, -117.70),
      new THREE.Vector3(2.45, 0, -119.5),
      -Math.PI * 0.12,
      1,
      true
    ));
    this.crewMembers.push(createHumanCrewMember(
      'tyre_on_fr',
      new THREE.Vector3(0.65, 0, -119.25),
      new THREE.Vector3(0.85, 0, -117.70),
      new THREE.Vector3(0.65, 0, -119.5),
      Math.PI * 0.12,
      1,
      true
    ));

    // REAR-LEFT (Wheel 2, hub at x = -1.25, z = -115.08, outward along +Z)
    this.crewMembers.push(createHumanCrewMember(
      'gunner_rl',
      new THREE.Vector3(-1.25, 0, -113.75),
      new THREE.Vector3(-1.25, 0, -113.75),
      new THREE.Vector3(-1.25, 0, -112.5),
      Math.PI,
      2,
      true
    ));
    this.crewMembers.push(createHumanCrewMember(
      'tyre_off_rl',
      new THREE.Vector3(-1.85, 0, -113.85),
      new THREE.Vector3(-1.65, 0, -114.30),
      new THREE.Vector3(-2.45, 0, -112.5),
      Math.PI * 1.12,
      2,
      true
    ));
    this.crewMembers.push(createHumanCrewMember(
      'tyre_on_rl',
      new THREE.Vector3(-0.65, 0, -112.75),
      new THREE.Vector3(-0.85, 0, -114.30),
      new THREE.Vector3(-0.65, 0, -112.5),
      Math.PI * 0.88,
      2,
      true
    ));

    // REAR-RIGHT (Wheel 3, hub at x = -1.25, z = -116.92, outward along -Z)
    this.crewMembers.push(createHumanCrewMember(
      'gunner_rr',
      new THREE.Vector3(-1.25, 0, -118.25),
      new THREE.Vector3(-1.25, 0, -118.25),
      new THREE.Vector3(-1.25, 0, -119.5),
      0,
      3,
      true
    ));
    this.crewMembers.push(createHumanCrewMember(
      'tyre_off_rr',
      new THREE.Vector3(-1.85, 0, -118.20),
      new THREE.Vector3(-1.65, 0, -117.70),
      new THREE.Vector3(-2.45, 0, -119.5),
      Math.PI * 0.12,
      3,
      true
    ));
    this.crewMembers.push(createHumanCrewMember(
      'tyre_on_rr',
      new THREE.Vector3(-0.65, 0, -119.25),
      new THREE.Vector3(-0.85, 0, -117.70),
      new THREE.Vector3(-0.65, 0, -119.5),
      -Math.PI * 0.12,
      3,
      true
    ));

    // 4. PIT CONTROLLER (Lollipop marshal - positioned ahead of the cockpit with zero overlap)
    this.crewMembers.push(createHumanCrewMember(
      'lollipop',
      new THREE.Vector3(2.65, 0, -113.1),
      new THREE.Vector3(2.65, 0, -113.1),
      new THREE.Vector3(2.65, 0, -112.2),
      Math.PI * 0.88
    ));
  }

  /**
   * Build 3D Wheel Props: Fresh New Slicks (on illuminated thermal racks) and Dismounted Worn Wheels
   */
  private buildPhysicalWheelProps(): void {
    const tireRadius = 0.35;
    const tireWidth = 0.32;

    // Fresh Pirelli Soft Slick Material (deep gloss, red soft compound stripe)
    const freshTireMat = new THREE.MeshStandardMaterial({
      color: 0x141416,
      roughness: 0.28, // Glossy fresh rubber straight from 100°C warmers!
      metalness: 0.05,
    });
    const freshRimMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      metalness: 0.90,
      roughness: 0.20,
    });
    const pzeroRedMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Pirelli P-Zero Soft Red
      roughness: 0.4,
      metalness: 0.1,
    });
    this.freshPzeroStripeMat = pzeroRedMat;

    // Used Dismounted Wheel Material (dull matte, brake dust patina)
    const usedTireMat = new THREE.MeshStandardMaterial({
      color: 0x222226,
      roughness: 0.92,
      metalness: 0.02,
    });
    const usedRimMat = new THREE.MeshStandardMaterial({
      color: 0x3f3f46,
      metalness: 0.65,
      roughness: 0.45,
    });
    const pzeroWornMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      roughness: 0.8,
    });
    this.dismountedPzeroStripeMat = pzeroWornMat;

    const sparePositions = [
      { x: 0.65, z: -113.3 }, // FL (Left side, outer face at -X)
      { x: 0.65, z: -118.7 }, // FR (Right side, outer face at +X)
      { x: -0.65, z: -113.3 },// RL (Left side, outer face at -X)
      { x: -0.65, z: -118.7 },// RR (Right side, outer face at +X)
    ];

    // Parked car orientation quaternion (yaw = Math.PI / 2)
    const parkedQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

    // 1. Build 4 Illuminated Thermal Tire Warmer Cradles
    const standAlloyMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.25,
    });
    const thermalCoilMat = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff3300,
      emissiveIntensity: 1.6,
      roughness: 0.35,
    });

    sparePositions.forEach((sp, idx) => {
      const standGroup = new THREE.Group();
      standGroup.position.set(sp.x, 0, sp.z);

      // Low-profile alloy base plate
      const baseGeo = new THREE.BoxGeometry(0.58, 0.06, 0.46);
      const baseMesh = new THREE.Mesh(baseGeo, standAlloyMat);
      baseMesh.position.y = 0.03;
      standGroup.add(baseMesh);

      // Curved tire cradle
      const cradleGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.36, 16, 1, true, -Math.PI * 0.35, Math.PI * 0.7);
      cradleGeo.rotateZ(Math.PI / 2);
      const cradle = new THREE.Mesh(cradleGeo, standAlloyMat);
      cradle.position.y = 0.36;
      standGroup.add(cradle);

      // Glowing thermal heating coils
      const coilGeo = new THREE.TorusGeometry(0.37, 0.014, 6, 16, Math.PI * 0.65);
      coilGeo.rotateY(Math.PI / 2);
      const coil = new THREE.Mesh(coilGeo, thermalCoilMat);
      coil.position.y = 0.36;
      standGroup.add(coil);

      // Digital Temperature LED (100°C Pre-Heated Pirelli Race Rubber)
      const ledGeo = new THREE.BoxGeometry(0.14, 0.05, 0.03);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.set(0, 0.12, idx % 2 === 1 ? -0.24 : 0.24);
      standGroup.add(led);

      this.group.add(standGroup);
    });

    // 2. Build 4 Fresh Pirelli Soft Slicks
    sparePositions.forEach((sp, idx) => {
      const isRight = (idx === 1 || idx === 3);
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(sp.x, 0.35, sp.z);
      wheelGroup.quaternion.copy(parkedQuat);
      wheelGroup.userData = {
        basePos: wheelGroup.position.clone(),
        baseQuat: wheelGroup.quaternion.clone(),
        wheelIndex: idx,
      };

      // Slick tire cylinder along local X axis
      const tireGeo = new THREE.CylinderGeometry(tireRadius, tireRadius, tireWidth, 24);
      tireGeo.rotateZ(Math.PI / 2);
      const tire = new THREE.Mesh(tireGeo, freshTireMat);
      tire.castShadow = true;
      wheelGroup.add(tire);

      // BBS Racing Rim
      const rimRadius = tireRadius * 0.65;
      const rimGeo = new THREE.CylinderGeometry(rimRadius, rimRadius, tireWidth + 0.005, 18);
      rimGeo.rotateZ(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, freshRimMat);
      wheelGroup.add(rim);

      // Pirelli Soft Red Sidewall Ring (on outer face)
      const pzeroGeo = new THREE.TorusGeometry(tireRadius * 0.82, 0.009, 6, 24);
      pzeroGeo.rotateY(Math.PI / 2);
      const pzeroRing = new THREE.Mesh(pzeroGeo, pzeroRedMat);
      pzeroRing.position.x = isRight ? (tireWidth / 2 + 0.005) : (-tireWidth / 2 - 0.005);
      wheelGroup.add(pzeroRing);

      // Monolug Centerlock Nut (Red on Left, Blue on Right)
      const nutGeo = new THREE.CylinderGeometry(0.065, 0.075, 0.08, 8);
      nutGeo.rotateZ(Math.PI / 2);
      const nutMat = new THREE.MeshStandardMaterial({
        color: isRight ? 0x1e40af : 0x991b1b,
        metalness: 0.92,
        roughness: 0.20,
      });
      const nut = new THREE.Mesh(nutGeo, nutMat);
      nut.position.x = isRight ? (tireWidth / 2 + 0.03) : (-tireWidth / 2 - 0.03);
      wheelGroup.add(nut);

      this.spareWheels.push(wheelGroup);
      this.group.add(wheelGroup);
    });

    // 3. Build 4 Dismounted Worn Wheels (Initially hidden)
    for (let i = 0; i < 4; i++) {
      const isRight = (i === 1 || i === 3);
      const dismountedGroup = new THREE.Group();
      dismountedGroup.visible = false;
      dismountedGroup.quaternion.copy(parkedQuat);

      const tireGeo = new THREE.CylinderGeometry(tireRadius, tireRadius, tireWidth, 20);
      tireGeo.rotateZ(Math.PI / 2);
      const tire = new THREE.Mesh(tireGeo, usedTireMat);
      dismountedGroup.add(tire);

      const rimRadius = tireRadius * 0.65;
      const rimGeo = new THREE.CylinderGeometry(rimRadius, rimRadius, tireWidth + 0.005, 16);
      rimGeo.rotateZ(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, usedRimMat);
      dismountedGroup.add(rim);

      // Faded sidewall ring
      const pzeroGeo = new THREE.TorusGeometry(tireRadius * 0.82, 0.007, 6, 20);
      pzeroGeo.rotateY(Math.PI / 2);
      const pzeroRing = new THREE.Mesh(pzeroGeo, pzeroWornMat);
      pzeroRing.position.x = isRight ? (tireWidth / 2 + 0.005) : (-tireWidth / 2 - 0.005);
      dismountedGroup.add(pzeroRing);

      // Worn Centerlock Nut
      const nutGeo = new THREE.CylinderGeometry(0.065, 0.075, 0.08, 8);
      nutGeo.rotateZ(Math.PI / 2);
      const nutMat = new THREE.MeshStandardMaterial({
        color: isRight ? 0x1e3a5f : 0x7f1d1d,
        metalness: 0.85,
        roughness: 0.4,
      });
      const nut = new THREE.Mesh(nutGeo, nutMat);
      nut.position.x = isRight ? (tireWidth / 2 + 0.03) : (-tireWidth / 2 - 0.03);
      dismountedGroup.add(nut);

      this.dismountedWheels.push(dismountedGroup);
      this.group.add(dismountedGroup);
    }
  }

  /**
   * Reset spare wheels and dismounted wheels to resting positions
   */
  public resetWheelProps(): void {
    this.spareWheels.forEach((w) => {
      if (w.userData?.basePos) {
        w.position.copy(w.userData.basePos);
        w.quaternion.copy(w.userData.baseQuat);
        w.visible = true;
      }
    });
    this.dismountedWheels.forEach((w) => {
      w.visible = false;
    });
  }

  /**
   * Build overhead high-pressure pneumatic tool booms extending from the pit wall
   */
  private buildAirBooms(): void {
    this.airBoomsGroup = new THREE.Group();
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.25 });
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6 });

    [-1.8, 1.8].forEach((bx) => {
      const mastGeo = new THREE.CylinderGeometry(0.06, 0.08, 4.5, 8);
      const mast = new THREE.Mesh(mastGeo, steelMat);
      mast.position.set(bx, 2.25, -112.5);
      this.airBoomsGroup.add(mast);

      const armGeo = new THREE.BoxGeometry(0.1, 0.1, 3.2);
      const arm = new THREE.Mesh(armGeo, steelMat);
      arm.position.set(bx, 4.4, -114.1);
      this.airBoomsGroup.add(arm);

      const hoseGeo = new THREE.CylinderGeometry(0.018, 0.018, 2.8, 6);
      const hose = new THREE.Mesh(hoseGeo, hoseMat);
      hose.position.set(bx, 3.0, -115.5);
      this.airHoses.push(hose);
      this.airBoomsGroup.add(hose);
    });

    this.group.add(this.airBoomsGroup);
  }

  /**
   * Build futuristic holographic CAD diagnostic laser scanning frame
   */
  private buildDiagnosticLaser(): void {
    this.scannerGroup = new THREE.Group();

    const barGeo = new THREE.BoxGeometry(0.08, 0.08, 3.6);
    const barMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9 });
    const barMesh = new THREE.Mesh(barGeo, barMat);
    barMesh.position.set(0, 1.85, -116);
    this.scannerGroup.add(barMesh);

    [-0.8, 0.8].forEach((zOff) => {
      const emitterGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8);
      const emitter = new THREE.Mesh(emitterGeo, barMat);
      emitter.position.set(0, 1.8, -116 + zOff);
      this.scannerGroup.add(emitter);
    });

    const beamGeo = new THREE.CylinderGeometry(0.018, 0.018, 3.5, 8);
    beamGeo.rotateX(Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    this.laserBeamMesh = new THREE.Mesh(beamGeo, beamMat);
    this.laserBeamMesh.position.set(0, 1.82, -116);
    this.scannerGroup.add(this.laserBeamMesh);

    const curtainGeo = new THREE.PlaneGeometry(3.5, 1.8);
    curtainGeo.rotateY(Math.PI / 2);
    const curtainMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    this.laserCurtainMesh = new THREE.Mesh(curtainGeo, curtainMat);
    this.laserCurtainMesh.position.set(0, 0.9, -116);
    this.scannerGroup.add(this.laserCurtainMesh);

    const gridGeo = new THREE.PlaneGeometry(3.4, 1.6, 8, 4);
    gridGeo.rotateX(-Math.PI / 2);
    const gridMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
    });
    this.holographicGridMesh = new THREE.Mesh(gridGeo, gridMat);
    this.holographicGridMesh.position.set(0, 0.55, -116);
    this.scannerGroup.add(this.holographicGridMesh);

    this.scannerGroup.visible = false;
    this.group.add(this.scannerGroup);
  }

  /**
   * Analytical Two-Bone Inverse Kinematics (Law of Cosines) Solver
   */
  private solveTwoBoneIK(
    arm: ArmIKJoints,
    targetWorld: THREE.Vector3,
    poleVectorWorld: THREE.Vector3
  ): void {
    arm.shoulder.updateWorldMatrix(true, false);
    const shoulderWorld = new THREE.Vector3();
    arm.shoulder.getWorldPosition(shoulderWorld);

    const toTarget = new THREE.Vector3().subVectors(targetWorld, shoulderWorld);
    let dist = toTarget.length();
    const maxReach = (arm.l1 + arm.l2) * 0.998;
    const minReach = Math.abs(arm.l1 - arm.l2) * 1.002;
    dist = Math.max(minReach, Math.min(maxReach, dist));

    const cosAlpha = Math.max(-1, Math.min(1, (arm.l1 * arm.l1 + dist * dist - arm.l2 * arm.l2) / (2 * arm.l1 * dist)));
    const alpha = Math.acos(cosAlpha);

    const cosBeta = Math.max(-1, Math.min(1, (arm.l1 * arm.l1 + arm.l2 * arm.l2 - dist * dist) / (2 * arm.l1 * arm.l2)));
    const beta = Math.acos(cosBeta);
    const elbowBend = Math.PI - beta;

    const targetDir = toTarget.clone().normalize();
    const pole = poleVectorWorld.clone().normalize();

    let limbNormal = new THREE.Vector3().crossVectors(targetDir, pole).normalize();
    if (limbNormal.lengthSq() < 0.001) {
      limbNormal = new THREE.Vector3(0, 1, 0);
    }

    const bendAxis = new THREE.Vector3().crossVectors(limbNormal, targetDir).normalize();
    const upperArmDirWorld = targetDir.clone().multiplyScalar(Math.cos(alpha)).add(bendAxis.clone().multiplyScalar(Math.sin(alpha))).normalize();

    const parentWorldQuat = new THREE.Quaternion();
    arm.shoulder.parent?.getWorldQuaternion(parentWorldQuat);
    const invParentQuat = parentWorldQuat.clone().invert();

    const localUpperArmDir = upperArmDirWorld.clone().applyQuaternion(invParentQuat);
    const defaultDir = new THREE.Vector3(0, -1, 0);
    const qAim = new THREE.Quaternion().setFromUnitVectors(defaultDir, localUpperArmDir);
    arm.shoulder.quaternion.copy(qAim);

    arm.elbow.rotation.set(arm.isRight ? elbowBend : -elbowBend, 0, 0);
  }

  public isCarAtPitEntry(carPos: { x: number; z: number }, speed: number): boolean {
    if (this.cooldownTimer > 0 || this.phase !== 'none') return false;
    const inEntryCorridor = carPos.x >= -74 && carPos.x <= -45 && carPos.z >= -126.0 && carPos.z <= -112.0;
    return inEntryCorridor && speed > 0.3;
  }

  public isCarInPitBox(carPos: { x: number; z: number }, carSpeed: number): boolean {
    if (this.cooldownTimer > 0 || this.phase !== 'none') return false;
    const b = this.pitBounds;
    const inBounds = carPos.x >= b.minX && carPos.x <= b.maxX && carPos.z >= b.minZ && carPos.z <= b.maxZ;
    return inBounds && Math.abs(carSpeed) < 7.0;
  }

  public startPitEntryAutopilot(physics: VehiclePhysics, audio?: EngineSound): void {
    if (this.phase !== 'none' || this.cooldownTimer > 0) return;

    this.dockStartPos = {
      x: physics.position.x,
      z: physics.position.z,
      yaw: physics.yaw,
    };

    const healthDamage = (100 - physics.damage.overallHealth) / 100;
    const engineDamage = (100 - physics.damage.engineHealth) / 100;
    const crumpleDamage = Math.max(physics.damage.frontCrumple, physics.damage.rearCrumple);
    const suspDamage = (200 - (physics.damage.suspensionLeft + physics.damage.suspensionRight)) / 200;

    const avgDamage = Math.max(0, Math.min(1.0, (healthDamage * 0.4 + engineDamage * 0.3 + crumpleDamage * 0.2 + suspDamage * 0.1)));
    this.initialDamageFraction = avgDamage;

    this.totalDuration = 5.2 + avgDamage * 6.0;
    this.elapsedTime = 0;
    this.repairProgress = 0;
    this.phase = 'entry_autopilot';
    this.hasTriggeredJackUpSound = false;
    this.hasTriggeredJackDownSound = false;
    this.hasTriggeredChime = false;
    this.hasTriggeredRadioEntry = true;
    this.hasTriggeredRadioTyres = false;
    this.hasTriggeredRadioExit = false;
    this.carElevatedY = 0;

    this.resetWheelProps();

    this.radioMessage = 'ENTRADA A BOXES · LIMITADOR 60 KM/H ACTIVADO';
    if (audio) {
      audio.triggerPitRadio('box');
    }

    const nextConfig = TIRE_COMPOUNDS[this.nextTireCompound] || TIRE_COMPOUNDS.soft;
    const oldConfig = TIRE_COMPOUNDS[physics.tireCompound] || TIRE_COMPOUNDS.soft;
    if (this.freshPzeroStripeMat) {
      this.freshPzeroStripeMat.color.setHex(nextConfig.stripeColorHex);
    }
    if (this.dismountedPzeroStripeMat) {
      this.dismountedPzeroStripeMat.color.setHex(oldConfig.stripeColorHex);
    }

    if (this.lollipopDiscMat) {
      this.lollipopDiscMat.color.setHex(0xdc2626);
      this.lollipopDiscMat.emissive.setHex(0xef4444);
    }
    if (this.lollipopSignGroup) {
      this.lollipopSignGroup.rotation.y = 0;
      this.lollipopSignGroup.rotation.x = 0;
    }
  }

  public startPitStop(physics: VehiclePhysics, audio?: EngineSound): void {
    if (this.phase !== 'none' || this.cooldownTimer > 0) return;

    this.dockStartPos = {
      x: physics.position.x,
      z: physics.position.z,
      yaw: physics.yaw,
    };

    const healthDamage = (100 - physics.damage.overallHealth) / 100;
    const engineDamage = (100 - physics.damage.engineHealth) / 100;
    const crumpleDamage = Math.max(physics.damage.frontCrumple, physics.damage.rearCrumple);
    const suspDamage = (200 - (physics.damage.suspensionLeft + physics.damage.suspensionRight)) / 200;

    const avgDamage = Math.max(0, Math.min(1.0, (healthDamage * 0.4 + engineDamage * 0.3 + crumpleDamage * 0.2 + suspDamage * 0.1)));
    this.initialDamageFraction = avgDamage;

    this.totalDuration = 5.2 + avgDamage * 6.0;
    this.elapsedTime = 0;
    this.repairProgress = 0;
    this.phase = 'docking';
    this.hasTriggeredJackUpSound = false;
    this.hasTriggeredJackDownSound = false;
    this.hasTriggeredChime = false;
    this.hasTriggeredRadioEntry = false;
    this.hasTriggeredRadioTyres = false;
    this.hasTriggeredRadioExit = false;
    this.carElevatedY = 0;

    const nextConfig = TIRE_COMPOUNDS[this.nextTireCompound] || TIRE_COMPOUNDS.soft;
    const oldConfig = TIRE_COMPOUNDS[physics.tireCompound] || TIRE_COMPOUNDS.soft;
    if (this.freshPzeroStripeMat) {
      this.freshPzeroStripeMat.color.setHex(nextConfig.stripeColorHex);
    }
    if (this.dismountedPzeroStripeMat) {
      this.dismountedPzeroStripeMat.color.setHex(oldConfig.stripeColorHex);
    }

    this.resetWheelProps();
  }

  public setNextTireCompound(compound: TireCompoundType): void {
    this.nextTireCompound = compound;
    const nextConfig = TIRE_COMPOUNDS[compound] || TIRE_COMPOUNDS.soft;
    if (this.freshPzeroStripeMat) {
      this.freshPzeroStripeMat.color.setHex(nextConfig.stripeColorHex);
    }
  }

  /**
   * Main Pit Stop Frame Update: Coreographed Multi-Stage 4-Wheel Mechanical Simulation
   */
  public update(
    dt: number,
    physics: VehiclePhysics,
    carModel: CarModel,
    particles: ParticleSystem,
    audio: EngineSound
  ): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= dt;
    }

    if (this.phase === 'none') {
      this.updateDisplayBoard();
      return;
    }

    // =========================================================================
    // STAGE 0: ENTRY AUTOPILOT (Speed Limiter 60 km/h)
    // =========================================================================
    if (this.phase === 'entry_autopilot') {
      this.elapsedTime += dt;
      const pitLimitSpeed = 16.67; // 60 km/h

      physics.position.z = THREE.MathUtils.damp(physics.position.z, -116.0, 5.0, dt);

      let angleDiff = (Math.PI / 2) - physics.yaw;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      physics.yaw += angleDiff * Math.min(1.0, dt * 6.0);

      physics.pitch = THREE.MathUtils.damp(physics.pitch, 0, 8.0, dt);
      physics.roll = THREE.MathUtils.damp(physics.roll, 0, 8.0, dt);
      physics.lateralSpeed = 0;
      physics.angularVelocity = 0;

      if (physics.position.x < -16.0) {
        physics.speed = THREE.MathUtils.damp(physics.speed, pitLimitSpeed, 5.0, dt);
        physics.position.x += physics.speed * dt;
        physics.gear = 2;
        physics.rpm = 1200 + (physics.speed / pitLimitSpeed) * 3200;
      } else {
        const distToStop = Math.max(0.01, -physics.position.x);
        const targetDecelSpeed = Math.min(pitLimitSpeed, Math.sqrt(distToStop * 14.0));
        physics.speed = THREE.MathUtils.damp(physics.speed, targetDecelSpeed, 6.0, dt);
        physics.position.x += physics.speed * dt;
        physics.gear = 1;
        physics.rpm = 1000 + (physics.speed / pitLimitSpeed) * 2200;

        const fj = this.crewMembers.find(m => m.type === 'front_jack');
        if (fj && physics.position.x > -5.0) {
          const stepT = Math.min(1.0, (physics.position.x + 5.0) / 4.0);
          fj.group.position.lerpVectors(fj.standbyPos, fj.servicePos, stepT);
        }
        const rj = this.crewMembers.find(m => m.type === 'rear_jack');
        if (rj && physics.position.x > -5.0) {
          const stepT = Math.min(1.0, (physics.position.x + 5.0) / 4.0);
          rj.group.position.lerpVectors(rj.standbyPos, rj.servicePos, stepT);
        }
      }

      if (physics.position.x >= -0.15 || (physics.position.x >= -2.0 && physics.speed < 0.65)) {
        physics.position.x = 0;
        physics.position.z = -116;
        physics.yaw = Math.PI / 2;
        physics.speed = 0;
        physics.rpm = 1000;
        physics.gear = 1;
        physics.isLockedInPit = true;

        this.phase = 'jacks_up';
        this.elapsedTime = 0.8;
      }
      return;
    }

    this.elapsedTime += dt;
    const t = this.elapsedTime;
    const total = Math.max(1, this.totalDuration);
    this.repairProgress = Math.min(1.0, t / total);

    // Subtle sway of hanging pneumatic hoses
    this.airHoses.forEach((hose, idx) => {
      hose.rotation.z = Math.sin(t * 3.5 + idx) * 0.05;
      hose.rotation.x = Math.cos(t * 3.0 + idx) * 0.03;
    });

    // =========================================================================
    // STAGE 1: DOCKING (0.0s - 0.8s)
    // =========================================================================
    if (t < this.dockDuration) {
      this.phase = 'docking';
      const dockT = Math.min(1.0, t / this.dockDuration);
      const easeDock = Math.sin(dockT * Math.PI * 0.5);

      physics.position.x = THREE.MathUtils.lerp(this.dockStartPos.x, 0, easeDock);
      physics.position.z = THREE.MathUtils.lerp(this.dockStartPos.z, -116, easeDock);

      let angleDiff = (Math.PI / 2) - this.dockStartPos.yaw;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      physics.yaw = this.dockStartPos.yaw + angleDiff * easeDock;

      physics.speed *= 0.80;
      physics.lateralSpeed = 0;
      physics.angularVelocity = 0;
      physics.pitch = THREE.MathUtils.lerp(physics.pitch, 0, 0.25);
      physics.roll = THREE.MathUtils.lerp(physics.roll, 0, 0.25);
      physics.isLockedInPit = true;

      if (!this.hasTriggeredRadioEntry) {
        this.radioMessage = 'BOX, BOX, BOX! STOP CONFIRMADO';
        audio.triggerPitRadio('box');
        this.hasTriggeredRadioEntry = true;
      }
    }
    // =========================================================================
    // STAGE 2: HYDRAULIC AIR JACKS ELEVATION (0.8s - 1.5s)
    // =========================================================================
    else if (t < 1.5) {
      this.phase = 'jacks_up';
      physics.position.x = 0;
      physics.position.z = -116;
      physics.yaw = Math.PI / 2;
      physics.speed = 0;
      physics.isLockedInPit = true;

      if (!this.hasTriggeredJackUpSound) {
        audio.triggerPneumaticJack(true);
        this.hasTriggeredJackUpSound = true;
        particles.emitPneumaticBlast(new THREE.Vector3(2.4, 0.12, -116), new THREE.Vector3(0, 0.8, 0), 6);
        particles.emitPneumaticBlast(new THREE.Vector3(-2.4, 0.12, -116), new THREE.Vector3(0, 0.8, 0), 6);
      }

      const liftT = (t - 0.8) / 0.7;
      // High-pressure lift to 0.20m
      this.carElevatedY = Math.sin(liftT * Math.PI * 0.5) * 0.20;

      this.crewMembers.forEach((m) => {
        if (m.type === 'front_jack' && m.toolMesh) {
          m.group.position.copy(m.servicePos);
          m.toolMesh.rotation.z = -liftT * 0.55;
          m.group.position.y = -liftT * 0.08;
        } else if (m.type === 'rear_jack' && m.toolMesh) {
          m.group.position.copy(m.servicePos);
          m.toolMesh.rotation.z = liftT * 0.55;
          m.group.position.y = -liftT * 0.08;
        }
      });
    }
    // =========================================================================
    // STAGE 3: FULL COMPONENT SERVICE & PHYSICAL 4-WHEEL TIRE SWAP (1.5s to total - 0.9s)
    // =========================================================================
    else if (t < total - 0.9) {
      this.phase = 'servicing';
      this.carElevatedY = 0.20;
      physics.position.x = 0;
      physics.position.z = -116;
      physics.yaw = Math.PI / 2;
      physics.speed = 0;
      physics.isLockedInPit = true;

      const serviceDuration = (total - 0.9) - 1.5;
      const serviceT = Math.max(0, Math.min(1.0, (t - 1.5) / serviceDuration));

      if (!this.hasTriggeredRadioTyres) {
        const targetComp = this.nextTireCompound || physics.tireCompound;
        const compConfig = TIRE_COMPOUNDS[targetComp] || TIRE_COMPOUNDS.soft;
        const oldCompConfig = TIRE_COMPOUNDS[physics.tireCompound] || TIRE_COMPOUNDS.soft;
        if (this.freshPzeroStripeMat) {
          this.freshPzeroStripeMat.color.setHex(compConfig.stripeColorHex);
        }
        if (this.dismountedPzeroStripeMat) {
          this.dismountedPzeroStripeMat.color.setHex(oldCompConfig.stripeColorHex);
        }
        // Update carModel wheel mesh stripe materials to new compound right as servicing starts
        // This ensures that when the new wheels are bolted on (p3 >= 0.95 & p4), they are ALREADY the new compound color!
        carModel.setTireCompoundVisuals(targetComp);

        this.radioMessage = `PISTOLAS ACTIVADAS · CAMBIO COMPLETO A ${compConfig.name.toUpperCase()} NUEVOS`;
        audio.triggerPitRadio('tyres');
        this.hasTriggeredRadioTyres = true;
      }

      // Reusable vectors and quaternion for physical accuracy
      const spindlePos = new THREE.Vector3();
      const axleOutDir = new THREE.Vector3();
      const hubQuat = new THREE.Quaternion();
      const poleVec = new THREE.Vector3(0, -1, 0);

      // --- PHYSICAL 4-WHEEL TIRE REPLACEMENT CHOREOGRAPHY ---
      for (let i = 0; i < 4; i++) {
        carModel.getSpindleWorldTransform(i, spindlePos, axleOutDir, hubQuat);
        const spare = this.spareWheels[i];
        const dismounted = this.dismountedWheels[i];
        const spareBasePos = spare.userData.basePos as THREE.Vector3;
        const cornerName = ['fl', 'fr', 'rl', 'rr'][i];
        const isLeft = (i % 2 === 0);
        const isFront = (i < 2);

        // 1. SUB-PHASE 3.1 (0.00 to 0.22): UNBOLTING & INITIAL GRIP
        if (serviceT < 0.22) {
          const p1 = serviceT / 0.22;
          carModel.setWheelVisible(i, true);
          carModel.setWheelOffset(i, 0);
          dismounted.visible = false;
          spare.visible = true;
          spare.position.copy(spareBasePos);
          spare.quaternion.copy(spare.userData.baseQuat);

          // Tyre-Off mechanic steps in and grasps tire sidewalls
          const offMech = this.crewMembers.find(m => m.type === `tyre_off_${cornerName}`);
          if (offMech && offMech.leftArmIK && offMech.rightArmIK) {
            offMech.group.position.lerpVectors(offMech.standbyPos, offMech.servicePos, p1);
            offMech.group.position.y = -0.06 * p1;
            const gripL = spindlePos.clone().add(axleOutDir.clone().multiplyScalar(0.18)).add(new THREE.Vector3(0.20, 0, 0));
            const gripR = spindlePos.clone().add(axleOutDir.clone().multiplyScalar(0.18)).add(new THREE.Vector3(-0.20, 0, 0));
            this.solveTwoBoneIK(offMech.leftArmIK, gripL, poleVec);
            this.solveTwoBoneIK(offMech.rightArmIK, gripR, poleVec);
          }

          // Tyre-On mechanic standing behind thermal rack ready to lift
          const onMech = this.crewMembers.find(m => m.type === `tyre_on_${cornerName}`);
          if (onMech && onMech.leftArmIK && onMech.rightArmIK) {
            onMech.group.position.copy(onMech.standbyPos);
            onMech.group.position.y = -0.08 * p1;
            const gripL = spareBasePos.clone().add(new THREE.Vector3(0.20, 0, 0));
            const gripR = spareBasePos.clone().add(new THREE.Vector3(-0.20, 0, 0));
            this.solveTwoBoneIK(onMech.leftArmIK, gripL, poleVec);
            this.solveTwoBoneIK(onMech.rightArmIK, gripR, poleVec);
          }

          // Gunner kneels right at nut with Paoli impact wrench unbolting
          const gunner = this.crewMembers.find(m => m.type === `gunner_${cornerName}`);
          if (gunner && gunner.leftArmIK && gunner.rightArmIK) {
            gunner.group.position.copy(gunner.servicePos);
            gunner.group.position.y = -0.16; // Stable kneeling posture
            const recoil = Math.sin(t * 54) * 0.016;
            const gunTargetR = spindlePos.clone().add(axleOutDir.clone().multiplyScalar(0.04)).add(new THREE.Vector3(0, recoil, 0));
            const gunTargetL = gunTargetR.clone().add(new THREE.Vector3(isLeft ? 0.08 : -0.08, 0.04, 0));
            this.solveTwoBoneIK(gunner.rightArmIK, gunTargetR, poleVec);
            this.solveTwoBoneIK(gunner.leftArmIK, gunTargetL, poleVec);
          }
        }
        // 2. SUB-PHASE 3.2 (0.22 to 0.48): TIRE EXTRACTION & DIAGONAL CLEARANCE
        else if (serviceT < 0.48) {
          const p2 = (serviceT - 0.22) / 0.26;
          // Nut is loose! Old wheel is pulled off the hub!
          carModel.setWheelVisible(i, false); // BARE SPINDLE, PERFORATED DISC & BREMBO CALIPER ARE VISIBLE!
          dismounted.visible = true;

          // 2.1 Dismounted Wheel Path:
          // In the first 40% of p2, wheel slides straight out along axle (0.50m).
          // In the remaining 60% of p2, Tyre-Off sweeps the wheel diagonally outward towards his exit lane!
          let dismountPos: THREE.Vector3;
          const straightOutPos = spindlePos.clone().add(axleOutDir.clone().multiplyScalar(0.55));
          if (p2 < 0.40) {
            const pullT = p2 / 0.40;
            const slideOutDist = Math.sin(pullT * Math.PI * 0.5) * 0.55;
            dismountPos = spindlePos.clone().add(axleOutDir.clone().multiplyScalar(slideOutDist));
          } else {
            const sweepT = (p2 - 0.40) / 0.60;
            const diagOutPos = straightOutPos.clone().add(new THREE.Vector3(isFront ? 0.45 : -0.45, 0, isLeft ? 0.25 : -0.25));
            dismountPos = new THREE.Vector3().lerpVectors(straightOutPos, diagOutPos, Math.sin(sweepT * Math.PI * 0.5));
          }
          dismounted.position.copy(dismountPos);
          dismounted.quaternion.copy(hubQuat);

          // Tyre-Off mechanic steps diagonally backwards pulling wheel off
          const offMech = this.crewMembers.find(m => m.type === `tyre_off_${cornerName}`);
          if (offMech && offMech.leftArmIK && offMech.rightArmIK) {
            offMech.group.position.lerpVectors(offMech.servicePos, offMech.exitPos, p2 * 0.45);
            offMech.group.position.y = -0.06;
            const gripL = dismountPos.clone().add(new THREE.Vector3(0.20, 0, 0));
            const gripR = dismountPos.clone().add(new THREE.Vector3(-0.20, 0, 0));
            this.solveTwoBoneIK(offMech.leftArmIK, gripL, poleVec);
            this.solveTwoBoneIK(offMech.rightArmIK, gripR, poleVec);
          }

          // Gunner steps/slides back by 0.38m along axleOutDir to clear extraction path
          const gunner = this.crewMembers.find(m => m.type === `gunner_${cornerName}`);
          if (gunner && gunner.leftArmIK && gunner.rightArmIK) {
            const gunnerClearPos = gunner.servicePos.clone().add(axleOutDir.clone().multiplyScalar(0.38));
            gunner.group.position.lerpVectors(gunner.servicePos, gunnerClearPos, Math.sin(p2 * Math.PI * 0.5));
            gunner.group.position.y = -0.16;
            // Gunner lowers wrench safely
            const gunTargetR = gunner.group.position.clone().add(new THREE.Vector3(0, 0.42, 0)).add(axleOutDir.clone().multiplyScalar(-0.20));
            const gunTargetL = gunTargetR.clone().add(new THREE.Vector3(isLeft ? 0.08 : -0.08, 0.04, 0));
            this.solveTwoBoneIK(gunner.rightArmIK, gunTargetR, poleVec);
            this.solveTwoBoneIK(gunner.leftArmIK, gunTargetL, poleVec);
          }

          // Tyre-On mechanic lifts fresh slick from thermal rack to staging waiting spot (x = ±0.85)
          // STAYS SAFELY TO THE SIDE WHILE OLD TIRE CLEARS! ZERO INTERSECTION!
          const onMech = this.crewMembers.find(m => m.type === `tyre_on_${cornerName}`);
          const stagingPos = spareBasePos.clone().add(new THREE.Vector3(isFront ? 0.20 : -0.20, 0.08, isLeft ? -0.45 : 0.45));
          const sparePos = new THREE.Vector3().lerpVectors(spareBasePos, stagingPos, Math.sin(p2 * Math.PI * 0.5));
          spare.visible = true;
          spare.position.copy(sparePos);
          spare.quaternion.copy(hubQuat);

          if (onMech && onMech.leftArmIK && onMech.rightArmIK) {
            onMech.group.position.lerpVectors(onMech.standbyPos, onMech.servicePos, p2 * 0.55);
            onMech.group.position.y = -0.08 * (1.0 - p2 * 0.5);
            const gripL = sparePos.clone().add(new THREE.Vector3(0.20, 0, 0));
            const gripR = sparePos.clone().add(new THREE.Vector3(-0.20, 0, 0));
            this.solveTwoBoneIK(onMech.leftArmIK, gripL, poleVec);
            this.solveTwoBoneIK(onMech.rightArmIK, gripR, poleVec);
          }
        }
        // 3. SUB-PHASE 3.3 (0.48 to 0.74): FRESH SLICK INSERTION ONTO SPINDLE
        else if (serviceT < 0.74) {
          const p3 = (serviceT - 0.48) / 0.26;

          // Tyre-Off mechanic carries old worn tire away towards pit exit/wall
          const offMech = this.crewMembers.find(m => m.type === `tyre_off_${cornerName}`);
          if (offMech && offMech.leftArmIK && offMech.rightArmIK) {
            offMech.group.position.lerpVectors(offMech.servicePos, offMech.exitPos, 0.45 + p3 * 0.55);
            offMech.group.position.y = 0;
            // Place carried wheel naturally in front of mechanic's torso based on facing direction
            const carryFrontZ = isLeft ? -0.28 : 0.28;
            const carryPos = offMech.group.position.clone().add(new THREE.Vector3(0, 0.45, carryFrontZ));
            dismounted.position.copy(carryPos);
            dismounted.visible = true;
            const gripL = carryPos.clone().add(new THREE.Vector3(0.20, 0, 0));
            const gripR = carryPos.clone().add(new THREE.Vector3(-0.20, 0, 0));
            this.solveTwoBoneIK(offMech.leftArmIK, gripL, poleVec);
            this.solveTwoBoneIK(offMech.rightArmIK, gripR, poleVec);
          }

          // Hub is now completely clear! Tyre-On slides fresh slick INWARD along the spindle
          const onMech = this.crewMembers.find(m => m.type === `tyre_on_${cornerName}`);
          const slideInDist = (1.0 - Math.sin(p3 * Math.PI * 0.5)) * 0.65;
          const sparePos = spindlePos.clone().add(axleOutDir.clone().multiplyScalar(slideInDist));
          spare.position.copy(sparePos);
          spare.quaternion.copy(hubQuat);

          // Seat flush onto hub at end of slide
          if (p3 >= 0.95) {
            spare.visible = false;
            carModel.setWheelVisible(i, true);
            carModel.setWheelOffset(i, 0);
          } else {
            spare.visible = true;
            carModel.setWheelVisible(i, false);
          }

          if (onMech && onMech.leftArmIK && onMech.rightArmIK) {
            onMech.group.position.copy(onMech.servicePos);
            onMech.group.position.y = -0.06;
            const gripL = sparePos.clone().add(new THREE.Vector3(0.20, 0, 0));
            const gripR = sparePos.clone().add(new THREE.Vector3(-0.20, 0, 0));
            this.solveTwoBoneIK(onMech.leftArmIK, gripL, poleVec);
            this.solveTwoBoneIK(onMech.rightArmIK, gripR, poleVec);
          }

          // Gunner moves back into position right behind sliding wheel, socket aligned to nut
          const gunner = this.crewMembers.find(m => m.type === `gunner_${cornerName}`);
          if (gunner && gunner.leftArmIK && gunner.rightArmIK) {
            gunner.group.position.copy(gunner.servicePos);
            gunner.group.position.y = -0.16;
            const gunTargetR = spindlePos.clone().add(axleOutDir.clone().multiplyScalar(Math.max(0.06, slideInDist + 0.08)));
            const gunTargetL = gunTargetR.clone().add(new THREE.Vector3(isLeft ? 0.08 : -0.08, 0.04, 0));
            this.solveTwoBoneIK(gunner.rightArmIK, gunTargetR, poleVec);
            this.solveTwoBoneIK(gunner.leftArmIK, gunTargetL, poleVec);
          }
        }
        // 4. SUB-PHASE 3.4 (0.74 to 1.00): HIGH-TORQUE 3000 Nm FASTENING & SIGNAL
        else {
          const p4 = (serviceT - 0.74) / 0.26;
          carModel.setWheelVisible(i, true);
          carModel.setWheelOffset(i, 0);
          spare.visible = false;
          dismounted.visible = true;

          // Tyre-Off mechanic resting safely at exit lane
          const offMech = this.crewMembers.find(m => m.type === `tyre_off_${cornerName}`);
          if (offMech && offMech.leftArmIK && offMech.rightArmIK) {
            offMech.group.position.copy(offMech.exitPos);
            offMech.group.position.y = 0;
            const restZ = isLeft ? -0.45 : 0.45;
            const restPos = offMech.exitPos.clone().add(new THREE.Vector3(0, 0.35, restZ));
            dismounted.position.copy(restPos);
            offMech.leftArmIK.shoulder.rotation.set(0.2, 0, 0);
            offMech.rightArmIK.shoulder.rotation.set(0.2, 0, 0);
          }

          // Tyre-On mechanic steps back clear of car behind thermal rack with hands raised
          const onMech = this.crewMembers.find(m => m.type === `tyre_on_${cornerName}`);
          if (onMech && onMech.leftArmIK && onMech.rightArmIK) {
            onMech.group.position.lerpVectors(onMech.servicePos, onMech.standbyPos, p4);
            onMech.group.position.y = 0;
            onMech.leftArmIK.shoulder.rotation.set(0.4, 0, 0);
            onMech.leftArmIK.elbow.rotation.set(0.6, 0, 0);
            onMech.rightArmIK.shoulder.rotation.set(0.4, 0, 0);
            onMech.rightArmIK.elbow.rotation.set(0.6, 0, 0);
          }

          // Gunner torquing centerlock nut with 3000 Nm rattle, recoil, sparks!
          const gunner = this.crewMembers.find(m => m.type === `gunner_${cornerName}`);
          if (gunner && gunner.leftArmIK && gunner.rightArmIK) {
            gunner.group.position.copy(gunner.servicePos);
            gunner.group.position.y = -0.16;

            if (p4 < 0.82) {
              const recoil = Math.sin(t * 60) * 0.020;
              const gunTargetR = spindlePos.clone().add(axleOutDir.clone().multiplyScalar(0.04)).add(new THREE.Vector3(0, recoil, 0));
              const gunTargetL = gunTargetR.clone().add(new THREE.Vector3(isLeft ? 0.08 : -0.08, 0.04, 0));
              this.solveTwoBoneIK(gunner.rightArmIK, gunTargetR, poleVec);
              this.solveTwoBoneIK(gunner.leftArmIK, gunTargetL, poleVec);
            } else {
              // Torquing complete! Gunner raises left arm high in the air signaling OK / READY!
              const gunTargetR = spindlePos.clone().add(axleOutDir.clone().multiplyScalar(0.18)).add(new THREE.Vector3(0, -0.12, 0));
              this.solveTwoBoneIK(gunner.rightArmIK, gunTargetR, poleVec);
              gunner.leftArmIK.shoulder.rotation.set(-1.4, 0, isLeft ? 0.4 : -0.4);
              gunner.leftArmIK.elbow.rotation.set(0.2, 0, 0);
            }
          }
        }
      }

      // --- HIGH-SPEED PNEUMATIC IMPACT WRENCH SOUNDS, AIR BLASTS & TORQUE SPARKS ---
      const isBolting = (serviceT < 0.24) || (serviceT > 0.74 && serviceT < 0.94);

      if (isBolting && t - this.lastGunSoundTime > 0.25) {
        audio.triggerWheelGunRattle();
        this.lastGunSoundTime = t;
      }

      if (isBolting && t - this.lastAirBurstTime > 0.18) {
        const randomWheelIdx = Math.floor(Math.random() * 4);
        carModel.getSpindleWorldTransform(randomWheelIdx, spindlePos, axleOutDir, hubQuat);
        particles.emitPneumaticBlast(spindlePos, axleOutDir, 6);
        this.lastAirBurstTime = t;
      }

      if (serviceT > 0.74 && serviceT < 0.94 && t - this.lastSparkTime > 0.07) {
        const randomWheelIdx = Math.floor(Math.random() * 4);
        carModel.getSpindleWorldTransform(randomWheelIdx, spindlePos, axleOutDir, hubQuat);
        particles.emitNutTorqueSparks(spindlePos, 12);
        this.lastSparkTime = t;
      }

      // Holographic CAD chassis scan
      this.scannerGroup.visible = true;
      const scanPeriod = 1.8;
      const scanX = Math.sin(((t - 1.5) / scanPeriod) * Math.PI * 2) * 2.3;
      this.scannerGroup.position.set(scanX, 0, -116);
      (this.laserCurtainMesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 14) * 0.15;

      // Real-time progressive vehicle restoration
      const lerpSpeed = Math.min(1.0, serviceT * 0.35 + 0.06);
      physics.damage.overallHealth = Math.min(100, physics.damage.overallHealth + (100 - physics.damage.overallHealth) * lerpSpeed);
      physics.damage.engineHealth = Math.min(100, physics.damage.engineHealth + (100 - physics.damage.engineHealth) * lerpSpeed);
      physics.damage.suspensionLeft = Math.min(100, physics.damage.suspensionLeft + (100 - physics.damage.suspensionLeft) * lerpSpeed);
      physics.damage.suspensionRight = Math.min(100, physics.damage.suspensionRight + (100 - physics.damage.suspensionRight) * lerpSpeed);
      physics.damage.frontCrumple = Math.max(0, physics.damage.frontCrumple - dt * 0.95);
      physics.damage.rearCrumple = Math.max(0, physics.damage.rearCrumple - dt * 0.95);
      physics.damage.wingLoose = false;
      physics.damage.isTotaled = false;
    }
    // =========================================================================
    // STAGE 4: JACKS DROP & SUSPENSION SLAM PHYSICS (total - 0.9s to total)
    // =========================================================================
    else if (t < total) {
      this.phase = 'jacks_down';
      this.scannerGroup.visible = false;
      carModel.setAllWheelsVisible(true);
      carModel.resetWheelOffsets();

      physics.position.x = 0;
      physics.position.z = -116;
      physics.yaw = Math.PI / 2;

      const dropTimeProgress = Math.max(0, Math.min(1.0, (t - (total - 0.9)) / 0.9));

      // Realistic gravitational drop & suspension compression bounce
      if (dropTimeProgress < 0.28) {
        // Fast gravitational drop (0.20m -> 0.0m)
        const fallRatio = dropTimeProgress / 0.28;
        this.carElevatedY = (1.0 - Math.pow(fallRatio, 2)) * 0.20;

        if (!this.hasTriggeredJackDownSound && fallRatio > 0.85) {
          audio.triggerPneumaticJack(false);
          this.hasTriggeredJackDownSound = true;
          particles.emitPneumaticBlast(new THREE.Vector3(0, 0.1, -116), new THREE.Vector3(0, 0.8, 0), 10);
        }
      } else {
        // Touchdown: Suspension squat & damped rebound oscillation
        const bounceT = (dropTimeProgress - 0.28) / 0.72;
        this.carElevatedY = Math.sin(bounceT * Math.PI * 3.5) * Math.exp(-bounceT * 4.5) * -0.035;
      }

      if (!this.hasTriggeredRadioExit) {
        this.radioMessage = '¡LUZ VERDE! 3, 2, 1... ¡GO GO GO!';
        audio.triggerPitRadio('go');
        this.hasTriggeredRadioExit = true;
      }

      // FRONT JACK OPERATOR: Yanks trolley jack clear to the side
      const fj = this.crewMembers.find(m => m.type === 'front_jack');
      if (fj) {
        fj.group.position.lerpVectors(fj.servicePos, fj.exitPos, dropTimeProgress);
        if (fj.toolMesh) {
          fj.toolMesh.rotation.z = THREE.MathUtils.lerp(fj.toolMesh.rotation.z, 0, 0.25);
        }
      }

      // REAR JACK OPERATOR: Steps aside
      const rj = this.crewMembers.find(m => m.type === 'rear_jack');
      if (rj) {
        rj.group.position.lerpVectors(rj.servicePos, rj.exitPos, dropTimeProgress);
        if (rj.toolMesh) {
          rj.toolMesh.rotation.z = THREE.MathUtils.lerp(rj.toolMesh.rotation.z, 0, 0.25);
        }
      }

      // Crew mechanics stand upright and step toward the pit wall
      this.crewMembers.forEach((m) => {
        if (!m.type.includes('jack') && m.type !== 'lollipop') {
          m.group.position.lerpVectors(m.group.position, m.exitPos, 0.18);
          m.group.position.y = THREE.MathUtils.lerp(m.group.position.y, 0, 0.25);
          if (m.rightArmIK) {
            m.rightArmIK.shoulder.rotation.set(0.3, 0, 0);
            m.rightArmIK.elbow.rotation.set(0.5, 0, 0);
          }
          if (m.leftArmIK) {
            m.leftArmIK.shoulder.rotation.set(0.3, 0, 0);
            m.leftArmIK.elbow.rotation.set(0.5, 0, 0);
          }
        }
      });

      // LOLLIPOP: Rotates to bright green "GO!" and swings UP into the air
      if (this.lollipopDiscMat) {
        this.lollipopDiscMat.color.setHex(0x10b981);
        this.lollipopDiscMat.emissive.setHex(0x34d399);
      }
      if (this.lollipopSignGroup) {
        this.lollipopSignGroup.rotation.y = THREE.MathUtils.lerp(this.lollipopSignGroup.rotation.y, Math.PI / 2, 0.25);
        this.lollipopSignGroup.rotation.x = THREE.MathUtils.lerp(this.lollipopSignGroup.rotation.x, -0.65, 0.25);
      }
    }
    // =========================================================================
    // STAGE 5: RELEASE & HIGH-RPM LAUNCH (t >= total)
    // =========================================================================
    else {
      if (this.phase !== 'released') {
        this.phase = 'released';
        this.carElevatedY = 0;
        this.scannerGroup.visible = false;
        carModel.setAllWheelsVisible(true);
        carModel.resetWheelOffsets();

        physics.setTireCompound(this.nextTireCompound);
        physics.repairFull();
        carModel.setTireCompoundVisuals(physics.tireCompound);

        if (!this.hasTriggeredChime) {
          audio.triggerPitChime();
          this.hasTriggeredChime = true;
        }

        physics.isLockedInPit = false;
        physics.speed = 6.2; // Powerful launch out of pit box
        physics.gear = 1;
        physics.rpm = 5400;

        // Emit launch tire burnout smoke puffs on the fresh rubber
        particles.emitTireSmoke(new THREE.Vector3(-1.25, 0.1, -114.65), 5, 0.85);
        particles.emitTireSmoke(new THREE.Vector3(-1.25, 0.1, -117.35), 5, 0.85);

        this.cooldownTimer = 7.5;
      }

      if (t >= total + 1.8) {
        this.phase = 'none';
        this.radioMessage = null;
        this.resetWheelProps();

        if (this.lollipopSignGroup) {
          this.lollipopSignGroup.rotation.y = 0;
          this.lollipopSignGroup.rotation.x = 0;
        }
        const fj = this.crewMembers.find(m => m.type === 'front_jack');
        if (fj) fj.group.position.copy(fj.standbyPos);
        const rj = this.crewMembers.find(m => m.type === 'rear_jack');
        if (rj) rj.group.position.copy(rj.standbyPos);
      }
    }

    this.updateDisplayBoard();
  }

  /**
   * Update the Pit Wall LED telemetry texture
   */
  private updateDisplayBoard(): void {
    const ctx = this.pitWallDisplayCanvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, 256, 128);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 120);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('APEX PIT SYSTEM', 16, 26);

    if (this.phase === 'none') {
      ctx.fillStyle = this.cooldownTimer > 0 ? '#38bdf8' : '#10b981';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(this.cooldownTimer > 0 ? 'CAR RELEASED' : 'BOX OPEN', 16, 68);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px monospace';
      ctx.fillText(this.cooldownTimer > 0 ? 'EXITING PIT LANE' : 'READY FOR SERVICE', 16, 96);
    } else if (this.phase === 'released') {
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('GO GO GO!', 16, 68);
      ctx.fillStyle = '#34d399';
      ctx.font = '14px monospace';
      ctx.fillText('TIRES: 4/4 FRESH SLICKS', 16, 96);
    } else {
      const remaining = Math.max(0, this.totalDuration - this.elapsedTime);
      ctx.fillStyle = remaining < 0.8 ? '#10b981' : '#f59e0b';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(`TIME: ${this.elapsedTime.toFixed(2)}s`, 16, 64);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 14px monospace';
      if (this.phase === 'docking') {
        ctx.fillText('DOCKING IN BOX...', 16, 92);
      } else if (this.phase === 'jacks_up') {
        ctx.fillText('AIR JACKS ELEVATION', 16, 92);
      } else if (this.phase === 'servicing') {
        ctx.fillText(`SWAPPING SLICKS: ${Math.round(this.repairProgress * 100)}%`, 16, 92);
      } else if (this.phase === 'jacks_down') {
        ctx.fillText('JACKS DROPPING · GREEN', 16, 92);
      }

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(16, 104, 224, 8);
      ctx.fillStyle = remaining < 0.8 ? '#10b981' : '#38bdf8';
      ctx.fillRect(16, 104, 224 * this.repairProgress, 8);
    }

    this.pitWallDisplayTex.needsUpdate = true;
  }

  /**
   * Load custom 3D model for pit crew mechanics (.glb, .gltf, .zip, .obj)
   */
  public async loadCustomCrewModel(file: File): Promise<{ success: boolean; name: string; error?: string }> {
    try {
      const importedData = await CrewModelImporter.loadFromFile(file);
      this.isCustomCrew = true;
      this.currentCrewName = importedData.name;
      this.customCrewProto = importedData.rootGroup;

      this.crewMembers.forEach((m) => {
        m.proceduralBody.visible = false;
        if (m.customBody) {
          m.group.remove(m.customBody);
        }
        const clone = importedData.rootGroup.clone(true);
        m.customBody = clone;
        m.group.add(clone);
        clone.visible = true;
      });

      return { success: true, name: importedData.name };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, name: '', error: msg };
    }
  }

  /**
   * Restore default high-detail procedural pit crew mechanics
   */
  public restoreDefaultCrew(): void {
    this.isCustomCrew = false;
    this.currentCrewName = 'Pit Crew Apex Scuderia';
    this.customCrewProto = null;

    this.crewMembers.forEach((m) => {
      if (m.customBody) {
        m.customBody.visible = false;
        m.group.remove(m.customBody);
        m.customBody = undefined;
      }
      m.proceduralBody.visible = true;
    });
  }
}
